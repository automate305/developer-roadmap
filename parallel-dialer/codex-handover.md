# Handover: Parallel Dialer — backend for the workstation, then live verification

You are picking up a parallel dialer (ConnectAndSell / Orum style) whose
telephony core is fully written, unit-tested, and building clean — but has
**never placed a real phone call**, and whose frontend just grew a surface
(Contacts, Lists, Reports) that the backend doesn't know about yet. Two lanes
of work, in this order:

1. **Give Contacts/Lists/Reports a real backend.** They exist only in
   browser `localStorage` right now — see "The new gap" below. This is
   yours to do today; nothing external blocks it.
2. **Gate 1: place a real call.** Proven nowhere yet. Blocked on Cam
   supplying Twilio/Deepgram/HubSpot credentials and standing up Railway —
   see "Gate 1" below for what to do while you wait and what to do the
   moment credentials land.

Do not rewrite the architecture. It was designed deliberately and the reasoning
is in the code comments. Read before you change.

---

## Where the code is

- **Repo:** `automate305/developer-roadmap`
- **Branches:** a stack of draft PRs, each based on the one below it —
  #4 `claude/parallel-dialer-webrtc-m6fcwa` (core dialer) →
  #5 `…-hubspot-retries` (durable CRM logging) →
  #6 `…-railway-deploy` →
  #7 `…-amd-audit` (classification audit + scorer) →
  #9 `…-agent-rules` (this file + `AGENTS.md`) →
  #10 `…-power-mode` (power-dial mode, the tabbed workstation — tip).
  **Work on the tip unless a change genuinely belongs lower down**, and cascade
  merges downward if you do change a lower branch.
- **Project root:** `parallel-dialer/` — self-contained.
- **Agent rules:** `parallel-dialer/AGENTS.md` is loaded automatically. Read it.

The repository root is unrelated roadmap.sh content with its own `package.json`.
**Do not touch anything outside `parallel-dialer/`.**

```
parallel-dialer/
  src/server.js                     Express + HTTP/WS server, upgrade routing, shutdown
  src/config/env.js                 validated config; fails at boot, not mid-call
  src/utils/logger.js               structured JSON logs, secret redaction
  src/backend/dialerEngine.js       parallel batch executor, winner race, sessions
  src/backend/streamHandler.js      Twilio→Deepgram relay + AMD state machine
  src/backend/hubspotService.js     v3 HMAC, lead queue, call activity logging
  src/backend/callActivityQueue.js  durable retry + dead-letter for CRM writes
  src/backend/classificationAudit.js  append-only AMD decision log
  src/backend/twilioClient.js       REST client, hangups, TwiML redirects, tokens
  src/backend/routes/{twiml,api,webhooks}.js
  src/frontend/App.jsx              masthead, tabs, cross-tab state (localStorage today)
  src/frontend/DialerDevice.jsx     Campaigns tab: WebRTC agent workstation
  src/frontend/tabs/ContactsTab.jsx CSV import + contacts spreadsheet
  src/frontend/tabs/ListsTab.jsx    named imports, "Start campaign"
  src/frontend/tabs/ReportsTab.jsx  dialed/connects/meetings, per session
  src/frontend/lib/csv.js           CSV parsing + header auto-matching
  scripts/score-amd.mjs             AMD scorer: latency, confusion matrix
  test/*.test.js                    69 node:test cases (backend only — no frontend tests exist)
```

## How it works, in one paragraph

A session dials N leads (3–5) at once. Each leg answers into
`<Connect><Stream>`, which forks the caller's inbound audio to `/media-stream`
over a WebSocket. Frames are base64 μ-law 8 kHz — exactly Deepgram's live
encoding — so they are decoded once and forwarded with no transcoding. A state
machine classifies HUMAN / MACHINE / NO_ANSWER from interim transcripts plus
three timers. The first HUMAN wins the batch and is redirected to
`<Dial><Client>agent_1</Client></Dial>`; every other leg is torn down.

---

## The new gap — Contacts / Lists / Reports / outcomes have no backend

The workstation (`src/frontend/App.jsx` + `src/frontend/tabs/*`) grew four
tabs: Campaigns (existing), Contacts, Lists, Reports. The last three are
**entirely client-side** — `src/frontend/lib/storage.js` wraps
`localStorage`, and that is the only place any of this data lives today.
`AGENTS.md` states this as a deliberate scope line, not an oversight, and
says explicitly: don't quietly wire a frontend call to a backend endpoint
that isn't there. This handover is you being asked to build that endpoint —
deliberately, with the design questions below answered first.

**Current shapes**, so you don't have to reverse-engineer them:

```js
// A contact, from ContactsTab.jsx / App.handleImport
{ id, company, firstName, lastName, title, email, phone1, phone2,
  companyUrl, linkedin, signal, status, listId, listName }

// A list, from App.handleImport
{ id, name, count, dialableCount, importedAt }

// A session summary, from DialerDevice.finishSession, appended on
// session:exhausted or a manual Stop
{ id, startedAt, endedAt, mode, listName, leadsTotal, stats, meetingsBooked }

// An outcome, logged from DialerDevice's post-call prompt — currently
// only ever bumps a client-side counter (logOutcome() in DialerDevice.jsx),
// never leaves the browser
{ key: 'meeting' | 'callback' | 'not_interested', phone, at }
```

**What "done" looks like:**

1. **Persistence for contacts/lists/session history.** This is a single
   Railway instance with an already-provisioned `/data` volume (see
   `DEPLOY_RAILWAY.md`) — the existing dead-letter and audit logs are
   JSONL files on that same volume. A single-file embedded database
   (`better-sqlite3` against a path under `/data`) fits that pattern and
   needs no new infrastructure; a JSONL log does not fit here because
   Contacts needs updates and lookups, not just appends. If you think a
   real service (Postgres, etc.) is warranted instead, say so and why
   before building it — that is an infrastructure decision, not a code
   one, and belongs to Cam.
2. **An outcome endpoint.** Something like
   `POST /api/calls/:callSid/outcome { outcome, notes? }` that persists the
   outcome and writes it into HubSpot via `hubspotService.js` — extend
   `buildCallBody`/`logCallActivity` or add a follow-up note on the same
   engagement, whichever the HubSpot API makes cleaner. `DialerDevice`'s
   `logOutcome()` (line 323) is where the frontend call belongs.
3. **Thread `contactId`/`name`/`company` through "Start campaign".**
   `App.handleStartCampaign` currently sends bare phone strings to the
   Campaigns dial list, discarding everything else on the contact. The
   session API already accepts lead objects (`normalizeLead` in
   `dialerEngine.js` takes `{phone, contactId, name, company}`) — nothing
   stops sending the full object today except that Contacts doesn't carry
   a HubSpot `contactId` at all (the CSV columns are company/name/etc., not
   a HubSpot object ID). Decide: does an imported CSV need a `contactId`
   column, or does the backend resolve one by phone at call time the way
   `logCallActivity` already falls back to `findContactIdByPhone`? The
   fallback already exists — you may not need new code here, just to
   verify it's actually adequate once outcomes need a `contactId` to write
   to.

Read `AGENTS.md`'s "Frontend tabs and where their data lives" section before
starting — it says the same thing this section does, written for a colder
read.

---

## Already proven — do not redo

- `npm test` → 69 passing (classifier, AMD timers and transitions, batch race,
  abandoned-call path, HMAC validation, queue throttling, CRM retry/dead-letter,
  audit fingerprinting, power-dial mode). No network needed.
- `npm run build` → clean Vite build.
- Server boots; `/api/health` responds; `/twiml/outbound` renders
  `<Connect><Stream>` with the leg parameters attached; an unsigned HubSpot
  webhook is rejected 401.
- Frontend renders correctly headless. The Contacts → Lists → Campaigns →
  Reports flow (CSV import, column auto-match, "Start campaign" loading
  normalized numbers, session-end auto-switch to Reports) was driven
  end-to-end through a real browser via Playwright before this branch was
  pushed — not just screenshotted per tab. No frontend test suite exists,
  though; that browser run isn't repeatable by `npm test`.

## Gate 1 — this is blocked on Cam, not on you

Everything involving a real carrier, real audio, or a real CRM write. None of
it can be proven without live Twilio/Deepgram/HubSpot credentials and a
Railway deployment (`DEPLOY_RAILWAY.md`), which is Cam's action, not yours.
**Do not fake this or mark it done from unit tests — nothing below has ever
been observed.** If credentials aren't available yet, work the new gap above
instead and leave this list for when they land; don't invent a workaround
that skips a real phone call.

1. Whether an outbound leg actually answers into the stream and audio arrives.
2. Whether Deepgram returns usable interim transcripts on 8 kHz μ-law phone audio.
3. Whether the `<Dial><Client>` redirect lands before the human hangs up.
4. Whether losing legs are torn down fast enough to keep the abandonment rate sane.
5. Whether the HubSpot Call engagement actually appears on the contact timeline.
6. **Actual AMD latency.** "Sub-300 ms" is a design target, not a measurement.
   `classificationLatencyMs` is recorded on every leg — collect real numbers.

---

## Traps — read these before touching the relevant file

These cost real debugging time to find. Do not regress them.

1. **Never close the Twilio media socket after a verdict.**
   `src/backend/streamHandler.js`, `#decide()`. Under `<Connect><Stream>` the
   stream verb *is* the call. Closing the socket advances the call to the next
   TwiML verb, and there isn't one, so Twilio hangs up — killing the very human
   you are about to bridge. Only the engine's REST redirect or hangup ends the
   call. This bug was found and fixed; there is a test pinning it
   (`leaves the Twilio socket to the engine`).

2. **The winner race is synchronous by construction.**
   `dialerEngine.js`, `#claimWinner()`. There is no `await` between the read of
   `batch.winnerLegId` and the write. Adding one anywhere in that method lets two
   humans win the same batch and bridges one of them into silence.

3. **Deepgram SDK v3 event names are not what you would guess.**
   `LiveTranscriptionEvents.Open === 'open'` (lowercase) and
   `LiveTranscriptionEvents.Transcript === 'Results'`. Use the enum, never string
   literals — the tests do this correctly, copy that pattern.

4. **HubSpot v3 HMAC is computed over the raw request bytes.**
   `req.rawBody`, captured in the body-parser `verify` hook in `server.js`.
   Re-serializing the parsed JSON changes key order and the signature will never
   match. Do not "clean up" that hook.

5. **Machine phrases are checked before greetings, on purpose.**
   `classifyTranscript()`. Voicemail routinely opens with "Hi" or "Hello"
   ("Hi, you've reached Dave's HVAC"). Reversing the order breaks the most
   common real-world case. A greeting only counts as human at ≤7 words.

6. **The Vercel check belongs to a different app. Leave it alone.**
   The `a305-sep-web` project builds `apps/sep`, which is unrelated to the
   dialer and arrived on `master` separately. It was red on these branches only
   while they predated that directory; merging `master` down the stack fixed it
   and all four checks are green. If it goes red again, read the build log
   before assuming it is yours — a failure in `apps/sep` is not a dialer
   failure. **Never create an `apps/sep` directory to satisfy a build setting.**

7. **The audio path does not transcode.** See `AGENTS.md` invariant 6. Adding
   resampling or buffering to the frame relay puts latency straight into the
   AMD decision the whole design exists to minimise.

8. **A `hidden` tab panel and its own `display` rule can tie on CSS
   specificity, and source order silently picks the wrong winner.**
   `src/frontend/styles.css` — `.tab-panel[hidden] { display: none; }` exists
   because `.tab-panel { display: flex }` (class selector) and the browser's
   default `[hidden] { display: none }` (attribute selector) are both
   specificity (0,1,0); without the explicit override, the later
   author-stylesheet rule wins and a "hidden" tab stays visible and
   interactive — its inputs `fill()`-able, its buttons clickable, invisibly
   stacked under whatever tab is actually showing. Found by scripting the CSV
   import through a real browser, not by screenshotting each tab. If you add
   a new `[hidden]`-toggled element with its own `display` rule, it needs the
   same override.

---

## Known gaps worth closing

Confirmed by reading the code, in rough priority order.

> Two gaps listed here originally are now **closed in PR #5**, with tests:
> agent misattribution on CRM writes (the leg's own `agentIdentity` is threaded
> through), and the unbounded `LeadQueue.seen` set (now a TTL-pruned, capped
> `Map`). Do not re-fix them.

1. **All state is in memory.** Sessions, batches and legs live in `Map`s on one
   process. A restart drops live calls, and it cannot scale past one instance.
   Fine for a pilot; needs Redis or similar before real load.

2. **Auth is a shared secret.** `x-dialer-key`, and the SSE endpoint takes it in
   the query string because `EventSource` cannot send headers. Replace with real
   identity before this is internet-facing.

3. **No rate limiting** on `POST /api/sessions`. A bad caller can open unbounded
   concurrent calls, which is a spend risk as much as a load one.

4. **Single-agent assumption.** One `DIALER_AGENT_IDENTITY` per process. Routing
   a batch to whichever agent is free is not implemented.

---

## Setup and commands

```bash
cd parallel-dialer
npm install
cp .env.example .env     # then fill it in — every key is documented inline
```

Twilio must reach the process over HTTPS, so run a tunnel and put its address in
`PUBLIC_BASE_URL`:

```bash
ngrok http 3000
```

You also need, in the Twilio console: an API key pair (for WebRTC tokens) and a
TwiML App whose Voice Request URL points at
`POST {PUBLIC_BASE_URL}/twiml/agent-outbound`.

```bash
npm test          # 69 unit tests, no network
npm run dev:all   # API on :3000, workstation on :5173
npm run build
npm run score:amd # AMD verdicts, latency percentiles, confusion matrix
```

Start a session by hand:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -H "x-dialer-key: $DIALER_API_KEY" \
  -d '{"agentIdentity":"agent_1","batchSize":3,
       "leads":["+1XXXXXXXXXX","+1XXXXXXXXXX","+1XXXXXXXXXX"]}'
```

Watch `/api/events` (SSE) or the JSON logs to follow the batch. Every leg logs
`classification`, `reason` and `latencyMs` at the moment of decision.

---

## Definition of done

**The new gap** (do this first — it needs nothing from Cam):

- Contacts, lists and session history survive a server restart, not just a
  page reload.
- Logging a call outcome writes to HubSpot, not only a client-side counter.
- `AGENTS.md` updated to match whatever storage choice you made, the same way
  it documents everything else load-bearing in this codebase.
- `npm test` and `npm run build` still clean, and the PR you worked on updated.

**Gate 1** (only once Cam has supplied credentials and a Railway deployment
exists):

- A live batch dials, one human is bridged to the browser workstation, and the
  other legs drop — observed, not inferred.
- Real `classificationLatencyMs` numbers collected across at least a few dozen
  calls, split by verdict, with the AMD thresholds tuned against what you see
  rather than the current defaults.
- A voicemail is correctly classified MACHINE and hung up without an agent
  hearing it.
- A HubSpot Call engagement appears on the right contact with the right
  duration and disposition.
- `npm test` and `npm run build` still clean, and the PR you worked on updated.

## Rules

- **Only dial numbers you control or have consent to call.** Use your own phones
  and Twilio test numbers. This is an outbound dialer; misuse has legal
  consequences under the TCPA. The README's compliance section is not decorative.
- Keep changes minimal and inside `parallel-dialer/`.
- If you disagree with a design decision, say so before changing it — the
  reasoning is in the comments and some of it is non-obvious.
