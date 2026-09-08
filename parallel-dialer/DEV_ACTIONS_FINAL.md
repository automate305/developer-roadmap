# Parallel Dialer — final development actions

Status as of 2026-09-07. Branch `claude/parallel-dialer-webrtc-m6fcwa`, PR #4 (draft),
head `1772148`.

**Where it stands:** the system is written, unit-tested and building clean. 31 tests
pass, the Vite build is clean, the server boots and serves correct TwiML. **No real
phone call has ever been placed through it.** Everything below is ordered by what
blocks what.

---

## 0. Blocking now — not a code problem

**Vercel check on PR #4 is red and no commit can fix it.**

The `a305-sep-web` Vercel project is connected to this repository but its Root
Directory is set to `apps/sep`, which does not exist here on any branch. The build
dies at directory resolution, one second after clone, before reading a file:

```
The specified Root Directory "apps/sep" does not exist. Please update your Project Settings.
```

It fails identically on `master`. Three ways out, all in the Vercel dashboard:
repoint the project at the repo that actually holds `apps/sep`; set Root Directory
to a path that exists here; or disconnect this repo from that project.

*Owner: Cam. Effort: 2 minutes. Do not create an `apps/sep` directory to satisfy it.*

---

## Gate 1 — before the first live call

Nothing here is optional. Until these pass, the system is unproven.

| # | Action | Why | Effort |
|---|---|---|---|
| 1.1 | Fill `.env` and stand up an HTTPS tunnel (`ngrok http 3000`), set `PUBLIC_BASE_URL` | Twilio cannot reach TwiML or the media socket otherwise | 30 min |
| 1.2 | Create Twilio API key pair + TwiML App pointing at `POST {PUBLIC_BASE_URL}/twiml/agent-outbound` | Required for WebRTC tokens and manual dials | 15 min |
| 1.3 | Dial a one-lead batch to your own phone. Confirm audio reaches `/media-stream` and Deepgram returns transcripts | Proves the whole fork path in one shot | 1 h |
| 1.4 | Dial a 3-lead batch. Confirm exactly one leg bridges and the other two drop | The core claim of the product | 1 h |
| 1.5 | Let one leg go to voicemail. Confirm MACHINE and hangup without the agent hearing it | The second core claim | 30 min |

**Only call numbers you control.** Use your own phones and Twilio test numbers.

---

## Gate 2 — before dialing real prospects

2.2, 2.3 and 2.4 are **done**, on branch `claude/parallel-dialer-hubspot-retries`.
2.1 and 2.5 need real calls and are still open.

### 2.1 Measure the latency, and the error you cannot see
`classificationLatencyMs` is recorded on every leg. "Sub-300 ms" is a design
target, not a measurement. Collect a few dozen calls, split by verdict, and tune
`AMD_INITIAL_SPEECH_TIMEOUT_MS`, `AMD_MAX_CONTINUOUS_SPEECH_MS` and the
`HUMAN_MAX_WORDS` threshold against what you see. Expect the defaults to be wrong.

**Latency is the easy half. The hard half is that the dialer can only ever
observe one of its two error types.** A false HUMAN is visible — the agent picks
up and hears a recording. A false MACHINE is invisible: the leg was hung up, so
nothing downstream ever learns it was a person. Same for a false NO_ANSWER.

Tuning on production behaviour alone would therefore tighten steadily toward
MACHINE, because the cost of tightening is the one number the system never sees.
You end up confident, well-tuned and wrong.

`AMD_AUDIT_PATH` now records every decision with its transcript, reason, latency
and a fingerprint of the config in force. Label a sample of the MACHINE and
NO_ANSWER records by reading their transcripts, then run:

```bash
npm run score:amd -- /data/amd-audit.jsonl
```

It reports verdict counts and latency percentiles from traffic alone, the
confusion matrix once labels exist, and — importantly — which verdicts are still
unlabelled, so a blind spot reads as a blind spot rather than a good score.
Records are grouped by config fingerprint: change a threshold or a pattern and
earlier decisions are answers to a different question, so they are not pooled.

150–200 labelled MACHINE verdicts is enough to see a real problem.

### 2.2 Fix the CRM agent misattribution — **done**
Each leg now carries the `agentIdentity` of the session that dialed it, and
`snapshotLeg` exposes it, so CRM logging attributes a call to the agent who took
it rather than to the process default.

### 2.3 Stop losing CRM writes silently — **done**
Writes go through `src/backend/callActivityQueue.js`: exponential backoff with
jitter on transient failures, no retry on terminal ones, an idempotency probe
against `hs_call_external_id` before every retry so a lost response cannot create
a duplicate, and a dead-letter file for anything that still fails. Pending writes
are flushed to that file on shutdown and replayed on boot.

Operational note: **monitor the dead-letter file.** A non-empty
`HUBSPOT_DEAD_LETTER_PATH` means real conversations are missing from the CRM.

### 2.4 Bound the lead queue's de-dupe set — **done**
`LeadQueue.seen` is a `Map` with a TTL (default 6 h) and a hard entry ceiling,
evicting oldest-first. A lead can also legitimately be re-dialed once its entry
expires, which the old unbounded `Set` prevented forever.

### 2.5 Confirm the abandonment rate in practice
The abandoned-call path and per-session counter exist and are tested, but have never
run against real humans answering. Watch `stats.abandoned` across real batches. If it
approaches 3%, drop `DIALER_BATCH_SIZE`. This is a legal threshold, not a preference.

---

## Gate 3 — before production or a second agent

| # | Action | Current state |
|---|---|---|
| 3.1 | Replace the `x-dialer-key` shared secret with real identity | Stopgap; the SSE endpoint takes the key in the query string because `EventSource` cannot send headers |
| 3.2 | Rate-limit `POST /api/sessions` | Absent. A bad caller can open unbounded concurrent calls — a spend risk as much as a load one |
| 3.3 | Move session/batch/leg state out of process memory | All in `Map`s. A restart drops live calls and it cannot scale past one instance |
| 3.4 | Implement agent routing | One `DIALER_AGENT_IDENTITY` per process. Routing a batch to whichever agent is free is not built |

---

## Decisions needed from you

- **Call recording.** Not implemented at all. If you want it, note that Florida is a
  two-party consent state, so it needs an announcement before the bridge, not after.
- **Where this deploys.** It needs a long-lived process with a stable public HTTPS
  endpoint for the WebSocket. Vercel is the wrong shape for it.
- **Whether the handover goes to Codex.** `codex-handover.md` is written and ready;
  it covers Gates 1 and 2 plus the six non-obvious traps in the codebase.

---

## Do not regress these

Found the hard way, each pinned by a test:

1. **Never close the Twilio media socket after a verdict** (`streamHandler.js`,
   `#decide()`). Under `<Connect><Stream>` the stream verb *is* the call; closing it
   advances to a nonexistent next TwiML verb and Twilio hangs up the human you are
   about to bridge.
2. **The winner race is synchronous by construction** (`dialerEngine.js`,
   `#claimWinner()`). Adding any `await` between the read and the write lets two
   humans win the same batch.
3. **Machine phrases are checked before greetings.** Voicemail routinely opens with
   "Hi" or "Hello". Reversing the order breaks the most common real case.
4. **HubSpot v3 HMAC is over the raw request bytes** (`req.rawBody`, captured in the
   body-parser `verify` hook). Re-serializing the parsed JSON breaks the signature.

---

## Verification

```bash
cd parallel-dialer
npm test            # 31 passing, no network required
npm run build:web   # clean
npm run dev:all     # API :3000, workstation :5173
```
