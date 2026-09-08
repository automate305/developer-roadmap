# Automate305 SEP

A self-hosted sales engagement platform: multi-step email sequences, per-mailbox
sending limits, open tracking, and IMAP reply detection that halts a sequence the
moment a lead answers.

Built as a standalone app inside this repository at `apps/sep`. Nothing outside
that directory is touched.

## Stack

| Concern | Choice |
| --- | --- |
| App + API | Next.js 16 (App Router, Server Actions), React 19 |
| Styling | Tailwind CSS 4, shadcn-style primitives on Radix Slot |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) |
| Queue | BullMQ 6 on Redis |
| Outbound | Nodemailer over SMTP |
| Inbound | imapflow + mailparser |

## Data model

```
Campaign ──┬── SequenceStep   (stepOrder, delayDays, subject/body with {{tags}})
           ├── Lead           (UNCONTACTED → IN_SEQUENCE → REPLIED / OPTED_OUT)
           └── EmailLog       (SENT / OPENED / BOUNCED / FAILED, openedAt, sentAt)

SendingAccount ── Campaign    (SMTP + IMAP credentials, maxDaily cap)
```

`prisma/schema.prisma` is the source of truth. Prisma 7 no longer reads the
connection string from the schema: migrations take it from `prisma.config.ts`
and the runtime client is built with a driver adapter in `lib/prisma.ts`.

## Getting started

```bash
cd apps/sep
npm install
cp .env.example .env          # fill in DATABASE_URL and REDIS_URL
npx prisma generate
npx prisma migrate deploy     # or `npx prisma migrate dev` while iterating
npx prisma db seed            # optional demo campaign
npm run dev                   # app on http://localhost:3000
npm run workers               # sender + scheduler + IMAP poller
```

`APP_URL` must be the origin recipients can reach, because it is baked into the
tracking pixel URL inside every outbound email.

## How a send happens

1. Activating a campaign schedules every uncontacted lead onto step 1
   (`lib/sequence.ts`).
2. The scheduler tick in `workers/index.ts` finds due leads once a minute and
   enqueues one job per lead and step. The job id is derived from lead and step,
   so a repeated tick cannot double-send.
3. `workers/email-worker.ts` renders the template, injects the tracking pixel,
   claims a slot against the mailbox's daily cap, writes the `EmailLog` row, then
   dispatches over SMTP and schedules the next step.
4. `/api/track/open` serves a 1x1 transparent GIF with `Cache-Control: no-store`
   and stamps `openedAt` plus an open counter.
5. `workers/reply-worker.ts` polls each mailbox every two minutes. A matched
   reply sets `Lead.status = REPLIED` and clears `nextSendAt`, which is what
   cancels the remaining steps.

### Execution guard

The worker refuses to send to a lead whose status is `REPLIED` or `OPTED_OUT`.
It checks twice: once when the job is picked up, and again immediately before
handing the message to SMTP, so a reply that lands mid-job still wins the race.
The scheduler independently skips those leads, and a halted lead has its
`nextSendAt` cleared.

## Mailbox credentials

SMTP and IMAP passwords are encrypted at rest with AES-256-GCM under
`CREDENTIAL_KEY`. The stored value is an envelope,
`v1:<iv>:<auth tag>:<ciphertext>`, and decryption happens only where the
password is used: building the SMTP transport, and opening the IMAP connection.

- Saving a sending account **fails** if `CREDENTIAL_KEY` is missing or is not 32
  bytes, rather than falling back to storing plaintext.
- GCM authenticates as well as encrypts, so a tampered ciphertext is rejected
  instead of decoding to garbage.
- A value without the `v1:` prefix is treated as legacy plaintext and passed
  through, so an existing install keeps working until it is migrated.

Migrate existing rows with:

```bash
npm run encrypt:credentials            # report what would change
npm run encrypt:credentials -- --apply # write the encrypted values
```

It is safe to re-run, and it decrypts each new value back before saving the row,
so a wrong key cannot lock a mailbox out of its own password.

Losing `CREDENTIAL_KEY` means re-entering every mailbox password. Back it up
where you keep other production secrets. Rotating it means decrypting with the
old key and re-encrypting with the new one; the `v1:` prefix is there to make
that possible without ambiguity.

## Bounces and suppression

A delivery report arrives from the postmaster, not from the lead, so the failed
address is read out of the report itself — the `Final-Recipient` and `Status`
fields of the `message/delivery-status` part, falling back to the wording
providers use when they send no machine-readable part. Matching on the `From`
header would miss almost every real bounce.

- **Hard bounce** (5.x.x, "user unknown", a 5xx at SMTP time) suppresses the
  address immediately.
- **Soft bounce** (4.x.x, mailbox full, greylisting) is counted. After
  `SOFT_BOUNCE_LIMIT` (3) the address is suppressed too, because repeatedly
  hitting a failing address costs sending reputation.
- A delivery receipt (2.x.x) and an ordinary human reply are neither.

Suppression is keyed on the **address**, not the lead, because the same owner
can sit in several campaigns. Suppressing halts every matching lead across all
campaigns, setting them to `BOUNCED` and clearing `nextSendAt`.

`BOUNCED` is deliberately its own lead status rather than reusing `OPTED_OUT`:
the recipient did not ask to leave, the address is simply undeliverable, and the
two want different reporting.

The send path checks the suppression list before every dispatch, so re-importing
a dead address into a fresh campaign does not revive it. A permanent rejection
at SMTP time returns a `bounced` outcome rather than throwing, so the queue does
not retry an address that will never accept mail.

`unsuppressAddress()` lifts a suppression and returns its leads to
`UNCONTACTED`, for an address a human judges deliverable again.

## Unsubscribing

Every lead carries an opaque `unsubscribeToken`, and every outbound message
offers two ways out:

- A footer link to `/unsubscribe/<token>`. That page does **not** opt anyone out
  on GET, because corporate link scanners fetch every link in inbound mail and
  would silently unsubscribe people who never clicked. The visitor confirms with
  a POST.
- RFC 8058 one-click headers (`List-Unsubscribe` and `List-Unsubscribe-Post`),
  so the recipient's own mail client shows a native unsubscribe button. That
  POSTs to `/api/unsubscribe?t=<token>` and acts immediately, as the RFC
  requires. Scanners do not POST, so this path is safe to action without
  confirmation.

Either route sets the lead to `OPTED_OUT`, stamps `optedOutAt` and clears
`nextSendAt`, which is what cancels every remaining step. Repeat requests are
idempotent, and an unknown token changes nothing and reveals nothing.

## Templating

Subjects and bodies support `{{firstName}}`, `{{lastName}}`, `{{company}}`,
`{{email}}`, `{{fullName}}`, and any extra CSV column captured at import.
A fallback follows a pipe: `{{firstName|there}}`.

## CSV import

`components/csv-importer.tsx` parses the file in the browser with papaparse,
auto-matches Email / First name / Last name / Company against common header
spellings, and shows a five-row preview before anything is written. Columns you
do not map are preserved as custom fields and stay usable as template tags.
`/api/leads/import` validates, lowercases and de-duplicates rows, then upserts in
chunks of 250 keyed on `(campaignId, email)`, so a re-import enriches existing
leads without resetting their progress.

## Validation

```bash
npm run typecheck
npm run build
npm run simulate      # end-to-end pipeline check, needs DATABASE_URL only
```

`scripts/simulate-pipeline.ts` seeds a campaign, dispatches step 1 through a
stubbed transport, calls the real tracking route, feeds in a simulated IMAP
reply, and asserts that every later step is refused. It also covers opt-outs,
daily-cap accounting, and the retry path. It cleans up after itself unless you
pass `--keep`.

## Operational notes

- Daily caps are per mailbox and reset at UTC midnight, rolled over lazily on the
  first send of a new day. A failed send returns its claimed slot.
- A send that hits the cap is deferred to the next UTC day rather than retried.
- Auto-replies and out-of-office messages are ignored; bounce notices mark the
  `EmailLog` as `BOUNCED` without halting the lead.
- Every server action returns `{ ok }` or `{ ok: false, error }`, and every page
  renders an error state instead of throwing when the database is unreachable.
- SMTP and IMAP passwords are stored as written. Put a secrets manager in front
  of this before using it against production mailboxes.

## Deploying to Vercel

### Automatic deployment is currently off

`vercel.json` sets `git.deploymentEnabled: false`. Pushes do not deploy.

This is deliberate. The Vercel project **a305-sep-web** was linked to the whole
`automate305/developer-roadmap` repository with root directory `apps/sep`, which
made it try to build *every* branch pushed to that repository. Branches that do
not contain `apps/sep` — other projects living in the same repo — failed with
"The specified Root Directory does not exist", putting red checks on unrelated
pull requests.

Two guards live here now:

- `git.deploymentEnabled: false` stops this project deploying from any branch
  that carries this file.
- `ignoreCommand` skips a build when a push changed nothing under `apps/sep`.

Neither can help a branch with no `apps/sep` at all, because Vercel resolves the
root directory before it reads `vercel.json`. Ending that requires disconnecting
the Git repository from the project in Vercel's dashboard (Settings → Git), or
deleting the project.

To bring deployment back, remove the `git` block — ideally once this app lives
somewhere it cannot collide with other projects: its own repository, or `master`
after this merges, so the directory exists on every branch.

Vercel hosts the dashboard, `/api/leads/import`, the tracking pixel at
`/api/track/open`, and the two scheduled routes that drive sending.

### Two ways to run the sending loop

The send path lives in `lib/dispatch.ts` and reply detection in `lib/inbound.ts`.
Both runtimes call the same code, so the execution guard, the per-mailbox daily
cap and the tracking pixel behave identically either way.

**Serverless (no extra host).** `/api/cron/dispatch` finds due leads and sends
them inline; `/api/cron/poll-replies` polls each mailbox over IMAP. Redis is not
involved. Schedules live in `vercel.json`.

**Long-lived workers (higher throughput).** `npm run workers` runs the BullMQ
scheduler, sender and reply poller against Redis on a host you control. Use this
when you outgrow the serverless cadence. Do not run both against one database at
the same cadence; pick one.

### Securing and scheduling the cron routes

Both routes require `Authorization: Bearer $CRON_SECRET` and refuse to run when
`CRON_SECRET` is unset, so they are never an open send trigger. Vercel Cron
sends that header automatically once the variable exists on the project.

Vercel's Hobby plan allows at most two cron jobs and only daily schedules, which
is why `vercel.json` ships with daily times. Sending on a realistic cadence needs
one of:

- **Vercel Pro** — change the schedules to `*/5 * * * *` (dispatch) and
  `*/2 * * * *` (replies).
- **Any external scheduler** — cron-job.org, GitHub Actions, Upstash, or a box
  you own, hitting the same URLs with the same bearer header:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/dispatch
  curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/poll-replies
  ```

Each dispatch run handles up to 40 leads by default (`?batch=` up to 200) and
stops at 45 seconds, reporting `truncated: true` when work remains so the next
run continues. Nothing is lost or double-sent: due leads are re-read each run and
a lead cannot receive the same step twice.

### Environment variables to set on the project

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string, including `?schema=sep`. Without it every page renders its error state; the build still succeeds. |
| `APP_URL` | yes | The deployment's own origin. It is baked into tracking pixel URLs, so it must be reachable by recipients. |
| `REDIS_URL` | workers only | Not read by any page or cron route. Set it wherever the BullMQ workers run. |
| `CRON_SECRET` | to send | Shared secret for `/api/cron/*`. Generate with `openssl rand -hex 32`. Without it the scheduled routes return 503. |
| `CREDENTIAL_KEY` | to save a mailbox | Encrypts SMTP and IMAP passwords at rest. Generate with `openssl rand -base64 32`. Losing it means re-entering every mailbox password. |

### Sharing a database with OUTBOX

The deployed instance points at the existing `a305-sep` Supabase project, whose
`public` schema belongs to OUTBOX. The SEP tables therefore live in a dedicated
`sep` schema and never touch it.

Two pieces make that work:

- The connection string carries `?schema=sep`. Prisma Migrate creates objects
  there, and `lib/env.ts` reads the same parameter (falling back to
  `DATABASE_SCHEMA`).
- `lib/prisma.ts` passes that schema to the pg driver adapter, so every
  generated query is qualified.

Nothing else in the app assumes a schema name; leaving the parameter off puts
the tables in `public`, which is what local development does.

To apply the schema to a fresh database:

```bash
cd apps/sep
DATABASE_URL="<connection string>?schema=sep" npx prisma migrate deploy
```

Redeploy afterwards so the running instance picks up the variables.
