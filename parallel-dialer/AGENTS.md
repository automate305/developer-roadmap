# Agent rules — parallel dialer

Read this before editing anything in `parallel-dialer/`. It is loaded
automatically by Cline, Codex and other agents that walk up from the working
directory; `CLAUDE.md` in this directory points here too.

This is an **outbound telephony system that places real phone calls and spends
real money**. The invariants below are not style preferences. Each one was paid
for in debugging time, and several look like bugs until you know why they exist.

---

## Scope

The repository root is unrelated roadmap.sh content with its own `package.json`
and its own Vercel project. **Do not touch anything outside `parallel-dialer/`.**
Do not add an `apps/sep` directory; that path belongs to a different app in this
monorepo and is not yours to create.

## Invariants — do not regress

1. **Never close the Twilio media socket after a verdict.**
   `src/backend/streamHandler.js`, `#decide()`. Under `<Connect><Stream>` the
   stream verb *is* the call. Closing the socket advances the call to the next
   TwiML verb; there isn't one, so Twilio hangs up — killing the very human you
   are about to bridge. Only the engine's REST redirect or hangup ends the call.
   Pinned by `leaves the Twilio socket to the engine`.

2. **The winner race is synchronous by construction.**
   `src/backend/dialerEngine.js`, `#claimWinner()`. There is no `await` between
   the read of `batch.winnerLegId` and the write. Adding one anywhere in that
   method lets two humans win the same batch and bridges one of them into
   silence.

3. **Machine phrases are matched before greetings, on purpose.**
   `classifyTranscript()`. Voicemail routinely opens with "Hi" or "Hello"
   ("Hi, you've reached Dave's HVAC"). Reversing the order breaks the most
   common real-world case. A greeting only counts as human at or below
   `HUMAN_MAX_WORDS`.

4. **Deepgram SDK v3 event names are not what you would guess.**
   `LiveTranscriptionEvents.Open === 'open'` (lowercase) and
   `LiveTranscriptionEvents.Transcript === 'Results'`. Use the enum, never
   string literals. The tests do this correctly — copy that pattern.

5. **HubSpot v3 HMAC is computed over the raw request bytes.**
   `req.rawBody`, captured in the body-parser `verify` hook in `src/server.js`.
   Re-serializing the parsed JSON changes key order and the signature will never
   match. Do not "clean up" that hook.

6. **The audio path does not transcode, and must not start.**
   Twilio sends base64 μ-law 8 kHz mono, which is exactly Deepgram's configured
   input encoding. Each 20 ms frame is one `Buffer.from(payload, 'base64')` and
   nothing else. Adding resampling, format conversion or buffering here puts
   latency directly into the AMD decision, which is the number the whole design
   optimises for.

7. **`railway.json` pins `numReplicas: 1`.**
   Sessions, batches and legs live in `Map`s in process memory. A second replica
   silently splits the batch registry and legs go missing. Raising this requires
   shared state first, not a config edit.

## Dialing modes

`screening: false` on a session is power-dial mode: the agent is bridged on the
`in-progress` status callback and **no AMD verdict is ever acted on**. The
classifier still runs and still records — that is deliberate, and the audit
rows it produces are how the thresholds get tuned. Do not "fix" the classifier
call in power-dial mode by making it hang up; a wrong verdict there would drop
a call the agent is already on. Guard bridging on `leg.connectedAt`, not only
on the winner claim: Twilio re-delivers status callbacks.

## Frontend tabs and where their data lives

The workstation is four tabs (`src/frontend/App.jsx`): Campaigns, Contacts,
Lists, Reports. Contacts, Lists and Session History are **server-side now**
(`src/backend/workspaceStore.js`) — three whole-file JSON documents under
`WORKSPACE_DATA_DIR` (default `./data/workspace`), loaded on boot and
rewritten atomically on every mutation, behind `GET/POST /api/workspace/*`
(`src/backend/routes/workspace.js`). This closed the gap this file used to
describe ("client-side state in `localStorage`, doesn't survive a restart"):
`App.jsx` now fetches `/api/workspace/state` on mount and POSTs/DELETEs
through the same router instead of calling `localStorage` directly. No
database — three JSON files were enough for pilot-scale data, matching how
`AMD_AUDIT_PATH` and `HUBSPOT_DEAD_LETTER_PATH` already do this.

An agent's own logged outcome (`Meeting booked` / `Follow up` / `Not
interested`, from the "Call notes" card) **does now reach HubSpot** —
`hubspotService.js#appendCallOutcome` appends a line to the same Call
engagement `logCallActivity` already created for that leg's `callSid`
(found via `findCallByExternalId`, not a second engagement), queued through
`CallActivityQueue` the same way the AMD-disposition write is, with its own
dead letter (`HUBSPOT_OUTCOME_DEAD_LETTER_PATH`). It is looked up by the
*outbound leg's* Twilio Call SID — not `call.parameters.CallSid`, which is
the inbound `<Dial><Client>` leg to the browser and a different call
entirely from the backend's point of view. `DialerDevice.jsx` captures the
right one (`connectedLegRef`) off the same `leg:classified` SSE event
`preConnectTranscriptRef` already reads, for the same best-effort-under-
parallel-dial reason. If that ref is empty when the agent logs an outcome,
the write is skipped with a visible warning rather than silently doing
nothing — say so the same way if you touch this path and hit a case where
the SID isn't available yet.

That same ref is also why the "On call" card can screen-pop a company/name
instead of just a phone number: `call.parameters.From` is this agency's own
Twilio caller ID (no `callerId` override on the `<Dial>` in
`dialerEngine.js#connectToAgent`, so Twilio defaults to the parent leg's
From), never the lead's number, so it was never usable for this either.
`App.handleStartCampaign` threads each list's `name`/`company` through
`loadRequest.contacts`; `startSession` attaches them to any lead whose phone
matches; `dialerEngine.js` carries them on `leg.lead` to every SSE event.
Deliberately not `contactId`: a workspace contact's `id` is this app's own
`crypto.randomUUID()`, and `logCallActivity` treats a truthy `contactId` as
authoritative (skipping its own working `findContactIdByPhone` fallback) —
sending our local id through would silently break the CRM association. See
codex-handover.md's former item 3 for the full reasoning if you touch this.

**The line rack** (the "Lines" panel, `batchLegs` state in `DialerDevice.jsx`)
is real per-leg state off the same `/api/events` SSE feed the Activity log
reads — not a mock. `batch:started` carries every leg in the new batch
(`snapshotBatch`'s `legs` array) and replaces `batchLegs` wholesale;
`leg:dialing`/`leg:streaming`/`leg:classified`/`leg:connected`/`leg:ended`
each carry one leg and upsert it by `legId`. `legPhase()` maps
`dialerEngine.js`'s `LegState`/`Disposition` enums to a tile label/tone —
if either enum changes, update `legPhase()` to match, it's a hand-written
mirror, not derived. One tile in power-dial mode (`batchSize` forced to 1),
up to ten in parallel mode.

Still genuinely unimplemented: real identity/auth beyond the one shared
`DIALER_API_KEY`, and routing across more than one agent. Those are still
new backend surface if asked for — say so rather than quietly wiring
something up.

**The Campaigns tab's "Call notes" card has a transcript section that is not
a live transcript.** It shows `preConnectTranscriptRef` — whatever Deepgram
heard during AMD classification, snapshotted onto the call the moment it
connects. The Deepgram socket is closed the instant a verdict is reached
(invariant 6 above), before the human conversation even starts, so nothing
from the actual call is ever captured. The empty-state copy in
`DialerDevice.jsx` says this outright — keep it that way if you touch that
card. Wiring real in-call transcription means keeping a media stream open
past the bridge (or forking the `<Dial>` leg's audio too), which is new
backend work, not a frontend fix.

## Changing AMD behaviour

`amdConfigFingerprint()` in `src/backend/classificationAudit.js` hashes the live
thresholds, `HUMAN_MAX_WORDS`, and the source of every pattern array. Audit rows
carry that fingerprint so a scoring run never mixes samples from two different
classifiers. If you add a tunable that changes a verdict, add it to the
fingerprint material — otherwise `scripts/score-amd.mjs` will silently pool
incomparable calls.

## Commands

```bash
cd parallel-dialer
npm install
npm test            # 90 unit tests, no network
npm run build       # server + web
npm run dev:all     # API on :3000, workstation on :5173
node scripts/score-amd.mjs   # AMD verdicts, latency percentiles, confusion matrix
```

Tests and build must both be clean before any push.

## Safety

- **Only dial numbers you control or have documented consent to call.** Use your
  own phones and Twilio test numbers. Misuse has consequences under the TCPA;
  the README's compliance section is not decorative.
- `DIALER_API_KEY` is the only thing in front of a control plane that can place
  outbound calls. Treat it as a password. Never log it, commit it, or put it in
  an example that could be copied verbatim.
- The abandoned-call TwiML in `#abandonLeg()` exists to satisfy the FCC's
  identification requirement when no agent is available. Do not remove it to
  make a test simpler.
- If you disagree with a design decision, say so before changing it. The
  reasoning is in the code comments and some of it is non-obvious.

## Longer context

`codex-handover.md` — what is proven, what has never been tested, and the
remaining gaps. `DEV_ACTIONS_FINAL.md` — the three gates to production.
`DEPLOY_RAILWAY.md` — deployment.
