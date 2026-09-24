# Handover: Parallel Dialer — live verification and hardening

You are picking up a parallel dialer (ConnectAndSell / Orum style) that is fully
written, unit-tested, and building clean — but has **never placed a real phone
call**. Your job is to prove the telephony path works end to end against live
Twilio and Deepgram, fix what breaks, and close the gaps listed at the bottom.

Do not rewrite the architecture. It was designed deliberately and the reasoning
is in the code comments. Read before you change.

---

## Where the code is

- **Repo:** `automate305/developer-roadmap`
- **Branch:** `claude/parallel-dialer-webrtc-m6fcwa` (PR #4, draft — keep working on this branch)
- **Project root:** `parallel-dialer/` — self-contained.

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
  src/backend/twilioClient.js       REST client, hangups, TwiML redirects, tokens
  src/backend/routes/{twiml,api,webhooks}.js
  src/frontend/DialerDevice.jsx     WebRTC agent workstation
  test/*.test.js                    31 node:test cases
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

## Already proven — do not redo

- `npm test` → 31 passing (classifier, AMD timers and transitions, batch race,
  abandoned-call path, HMAC validation, queue throttling). No network needed.
- `npm run build:web` → clean Vite build.
- Server boots; `/api/health` responds; `/twiml/outbound` renders
  `<Connect><Stream>` with the leg parameters attached; an unsigned HubSpot
  webhook is rejected 401.
- Frontend renders correctly headless.

## Never tested — this is the job

Everything involving a real carrier, real audio, or a real CRM write:

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

6. **The Vercel check on PR #4 is red and it is not the code's fault.**
   The `a305-sep-web` Vercel project points its Root Directory at `apps/sep`,
   which does not exist in this repo on any branch. The build dies at directory
   resolution before reading a file. It fails identically on `master`. This needs
   a Vercel dashboard change by the repo owner. **Do not attempt a code fix, and
   do not create an `apps/sep` directory to satisfy it.**

---

## Known gaps worth closing

Confirmed by reading the code, in rough priority order.

1. **CRM activity misattributes the agent under multi-agent use.**
   `server.js:156` and `:193` pass `config.dialer.agentIdentity` — a global — to
   `logCallActivity`. Every call gets logged against the default agent regardless
   of which session's agent actually took it. Thread the leg's own session
   `agentIdentity` through instead.

2. **`LeadQueue.seen` grows without bound.**
   `hubspotService.js`. The de-dupe `Set` is only emptied by `clear()`, so a
   long-running process accumulates one entry per lead forever. Needs a TTL or a
   bounded structure.

3. **All state is in memory.** Sessions, batches and legs live in `Map`s on one
   process. A restart drops live calls, and it cannot scale past one instance.
   Fine for a pilot; needs Redis or similar before real load.

4. **Auth is a shared secret.** `x-dialer-key`, and the SSE endpoint takes it in
   the query string because `EventSource` cannot send headers. Replace with real
   identity before this is internet-facing.

5. **No rate limiting** on `POST /api/sessions`. A bad caller can open unbounded
   concurrent calls, which is a spend risk as much as a load one.

6. **Single-agent assumption.** One `DIALER_AGENT_IDENTITY` per process. Routing
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
npm test          # 31 unit tests, no network
npm run dev:all   # API on :3000, workstation on :5173
npm run build:web
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

- A live batch dials, one human is bridged to the browser workstation, and the
  other legs drop — observed, not inferred.
- Real `classificationLatencyMs` numbers collected across at least a few dozen
  calls, split by verdict, with the AMD thresholds tuned against what you see
  rather than the current defaults.
- A voicemail is correctly classified MACHINE and hung up without an agent
  hearing it.
- A HubSpot Call engagement appears on the right contact with the right
  duration and disposition.
- Gaps 1 and 2 above fixed with tests.
- `npm test` and `npm run build:web` still clean. PR #4 updated.

## Rules

- **Only dial numbers you control or have consent to call.** Use your own phones
  and Twilio test numbers. This is an outbound dialer; misuse has legal
  consequences under the TCPA. The README's compliance section is not decorative.
- Keep changes minimal and inside `parallel-dialer/`.
- If you disagree with a design decision, say so before changing it — the
  reasoning is in the comments and some of it is non-obvious.
