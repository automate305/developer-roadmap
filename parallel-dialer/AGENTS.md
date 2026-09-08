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
npm test            # 64 unit tests, no network
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
