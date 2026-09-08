# Parallel Dialer

An open-source parallel dialer in the mould of ConnectAndSell and Orum: it rings
several numbers at once, decides in well under a second whether a real person
picked up, and bridges the first human onto an agent's browser before they
finish saying "hello". Everything else in the batch is dropped.

Node.js (ESM) backend, React + Vite agent workstation, Twilio for telephony and
WebRTC, Deepgram Nova-2 for streaming answer detection, HubSpot for CRM.

---

## Why it is fast

Twilio's built-in `machineDetection` waits for a greeting to finish, which costs
two to four seconds. This system never uses it. When a leg answers, the call
executes `<Connect><Stream>`, which forks the caller's inbound audio to a
WebSocket. Those frames are already base64 μ-law at 8 kHz mono, which is exactly
what Deepgram's live API accepts, so each frame is base64-decoded once and
forwarded. No resampling, no PCM conversion, no ffmpeg.

Deepgram interim results arrive while the caller is still speaking, so a
one-word greeting produces a verdict without waiting for the utterance to
finalise.

## Answer detection state machine

```
IDLE ──start──▶ LISTENING ──┬─ machine phrase in transcript ──▶ MACHINE
                            ├─ greeting phrase in transcript ─▶ HUMAN
                            ├─ speech block > 2.8 s ──────────▶ MACHINE
                            ├─ no speech by 3.8 s ────────────▶ NO_ANSWER
                            └─ 9 s hard deadline ─────────────▶ MACHINE

Any state ──socket close before a verdict──▶ ABORTED (no classification)
```

| Timer | Default | Fires when | Meaning |
| --- | --- | --- | --- |
| `AMD_INITIAL_SPEECH_TIMEOUT_MS` | 3800 | armed on answer, never disarmed by speech | dead air: a silent IVR, a dropped carrier leg, or a machine that has not started |
| `AMD_MAX_CONTINUOUS_SPEECH_MS` | 2800 | armed when speech starts, cleared when it pauses | only a recording talks straight through 2.8 s without a break |
| `AMD_DECISION_DEADLINE_MS` | 9000 | nothing else has decided | release the line rather than hold it open |

Machine phrases are checked before greetings, because a voicemail greeting very
often opens with "Hi" or "Hello". A greeting only counts as human when the whole
utterance is seven words or fewer.

## Dialing modes

The same engine runs three modes. They differ in one question — *what decides
that a call reaches the agent* — and that answer sets the risk.

| Mode | Settings | Who decides | Risk it carries |
| --- | --- | --- | --- |
| **Power dial** | `batchSize: 1`, `screening: false` | The callee answering | None of the below |
| **Screened power dial** | `batchSize: 1`, `screening: true` | The AMD verdict | A wrong MACHINE verdict silently drops a live prospect |
| **Parallel dial** | `batchSize: 3–5`, `screening: true` | The AMD verdict, first HUMAN wins | The above, plus abandoned calls under the FCC's 3% cap |

Setting `screening: false` forces `batchSize` to 1. That is an interlock, not
tidiness: with screening off the abandoned-call announcement in `classify()`
never runs, so a second human answering a parallel batch would be hung up on
silently — the one thing the FCC requires you to announce. One line leaves no
losing leg, so the case cannot arise.

**Power dial is the place to start**, and not only because it is simplest. One
line per agent means there is no losing leg, so nothing can be abandoned and
the 3% rule cannot be breached. Bridging on answer means no classifier verdict
stands between a prospect and your agent, so the invisible failure — a false
MACHINE hanging up on a real person who then never hears from you — cannot
happen.

What makes it more than a fallback: **the classifier still runs in power-dial
mode, and still records.** Every call writes an audit row with the verdict it
*would* have given, while your agent's own disposition supplies the truth. Run
a few hundred power dials and `npm run score:amd` prints a real confusion
matrix — which is exactly the evidence needed to trust screening, and later
parallel dialing. The simple mode is how the fast mode earns its thresholds.

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -H "x-dialer-key: $DIALER_API_KEY" \
  -d '{"agentIdentity":"agent_1","batchSize":1,"screening":false,
       "leads":["+1XXXXXXXXXX"]}'
```

## Workstation tabs

The frontend is four tabs sharing one masthead: **Campaigns** (the dial
session above), **Contacts** (CSV import and a spreadsheet view), **Lists**
(every import as a named batch you can hand to a campaign), and **Reports**
(dialed / connects / meetings booked, per session).

The flow is Contacts → Lists → Campaigns → Reports: import a CSV, start a
campaign from the list it becomes, dial, and land on Reports when the
campaign ends. Column matching is header-driven — `company`, `first_name`,
`last_name`, `title`, `email`, `phone1` (the cell — the number the dialer
actually calls), `phone2`, `company_url`, `linkedin`, `signal`, `status`, with
common aliases (`cell`, `mobile`, `website`, …) recognized automatically.

**Contacts, lists, session history, and meeting-booked outcomes live in the
browser's `localStorage` today — there is no backend model for any of them.**
That is a scope line, not an oversight: the dialer's own state (sessions,
legs, the HubSpot write) is what has to be right before any of this needs a
server home too. Concretely, this means: it resets if you clear site data,
it does not sync between agents or machines, and a meeting an agent logs
after a call does not yet reach the HubSpot timeline — only the engine's own
AMD dispositions (HUMAN/MACHINE/NO_ANSWER/…) do. Durable, shared contacts and
reporting is real backend work — a database, real per-agent auth beyond the
one shared `DIALER_API_KEY`, and an endpoint to attach an agent's outcome to
a call — and is deliberately out of scope here.

## Batch race and abandoned calls

The first leg classified `HUMAN` claims the batch through a synchronous
check-and-set with no `await` between the read and the write, so two
simultaneous humans cannot both win. The winner is redirected to
`<Dial><Client>agent_1</Client></Dial>`; every other live leg is torn down over
the REST API.

A losing leg that was itself classified as a human is an abandoned call. Those
callers hear a spoken identification message rather than a dead line, and the
count is tracked per session so the abandonment rate stays auditable against the
FCC 3% safe harbour. Keep the batch size at three to five; higher numbers raise
the abandonment rate faster than they raise connect rate.

## Architecture

```
                    ┌─────────────────────────┐
  HubSpot ──POST──▶ │ /api/webhooks/hubspot-  │──▶ LeadQueue (throttled)
  (signed v3)       │  lead                   │        │
                    └─────────────────────────┘        ▼
                                              ┌──────────────────┐
  Agent browser ◀──SSE── /api/events ◀────────│  DialerEngine    │
        │                                     │  batch executor  │
        │  GET /api/token                     └──────────────────┘
        │  POST /api/sessions                    │  N parallel calls
        ▼                                        ▼
  Twilio Voice SDK  ◀──<Dial><Client>──  Twilio REST API
   (WebRTC Device)                              │
                                                │ answer TwiML
                                                ▼
                                    <Connect><Stream> ──wss──▶ /media-stream
                                                                    │
                                                          μ-law 8kHz, no transcode
                                                                    ▼
                                                          Deepgram Nova-2 live
```

## File map

| Path | Responsibility |
| --- | --- |
| `src/server.js` | Express app, HTTP server, WebSocket upgrade routing, graceful shutdown |
| `src/config/env.js` | Validated configuration; fails loudly at boot, not mid-call |
| `src/utils/logger.js` | Structured JSON logging with secret redaction |
| `src/backend/dialerEngine.js` | Parallel batch executor, winner race, session state |
| `src/backend/streamHandler.js` | Twilio to Deepgram relay and the AMD state machine |
| `src/backend/hubspotService.js` | Signature validation, lead queue, call activity logging |
| `src/backend/twilioClient.js` | REST client, hangups, live TwiML redirects, access tokens |
| `src/backend/routes/twiml.js` | Twilio voice webhooks |
| `src/backend/routes/api.js` | Token, session control, SSE activity feed |
| `src/backend/routes/webhooks.js` | HubSpot lead intake |
| `src/frontend/App.jsx` | Masthead, tabs, and the state shared across them (contacts, lists, session history) |
| `src/frontend/DialerDevice.jsx` | The Campaigns tab — device, dial list, live call, activity |
| `src/frontend/tabs/ContactsTab.jsx` | CSV import and the contacts spreadsheet |
| `src/frontend/tabs/ListsTab.jsx` | Every import as a named batch, with "Start campaign" |
| `src/frontend/tabs/ReportsTab.jsx` | Dialed / connects / meetings booked, per session |
| `src/frontend/lib/csv.js` | CSV parsing and column auto-matching |

## Setup

```bash
npm install
cp .env.example .env      # then fill it in
```

Twilio needs to reach this process over HTTPS, so in development run a tunnel
and put its address in `PUBLIC_BASE_URL`:

```bash
ngrok http 3000
```

In the Twilio console, create an API key pair for WebRTC tokens and a TwiML App
whose Voice Request URL points at `POST {PUBLIC_BASE_URL}/twiml/agent-outbound`.
In HubSpot, create a private app with the `crm.objects.contacts` and
`crm.objects.calls` scopes, and point a webhook subscription at
`POST {PUBLIC_BASE_URL}/api/webhooks/hubspot-lead`.

Then:

```bash
npm run dev:all           # API on :3000, workstation on :5173
```

Open http://localhost:5173, click **Go online**, paste E.164 numbers into the
dial list, and start dialing.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | liveness |
| `GET` | `/api/token?identity=agent_1` | Voice SDK access token |
| `POST` | `/api/sessions` | start a dialing session |
| `GET` | `/api/sessions/:id` | session snapshot |
| `DELETE` | `/api/sessions/:id` | stop a session, drop every live leg |
| `GET` | `/api/events` | SSE feed of dialer activity |
| `POST` | `/api/webhooks/hubspot-lead` | signed lead intake |
| `POST` | `/twiml/outbound` | answer document opening the media stream |
| `POST` | `/twiml/status` | call status callbacks |
| `POST` | `/twiml/bridge-status` | fires when the agent bridge ends |
| `POST` | `/twiml/agent-outbound` | TwiML App target for manual dials |
| `WS` | `/media-stream` | Twilio Media Streams audio |

Start a session:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -H 'x-dialer-key: change-me-local-dev-only' \
  -d '{"agentIdentity":"agent_1","batchSize":4,
       "leads":["+13055550101","+13055550102","+13055550103","+13055550104"]}'
```

## Security notes

HubSpot webhooks are validated with the v3 HMAC over
`method + uri + rawBody + timestamp`, compared in constant time, with a
five-minute replay window. The raw request bytes are captured in the body
parser's `verify` hook, because re-serialising the parsed JSON changes key order
and breaks the hash.

Twilio webhooks are validated with `X-Twilio-Signature` unless
`TWILIO_VALIDATE_SIGNATURE=false`.

The `x-dialer-key` shared secret on the control plane is a stopgap for local
development. Put a real identity provider in front of `/api` before you expose
this to the internet.

## Theme

The workstation uses the OUTBOX palette (`outbox.automate305.com`), so the dialer
reads as part of the same product. The eleven brand values are lifted verbatim,
along with the signature treatments: gradient glass panels, the purple gradient
primary button, and the light frosted fields on a dark shell.

Every colour in `src/frontend/styles.css` resolves to a token in the `:root`
block, so re-skinning means replacing that block and nothing else. Purple is the
primary action, which is why the in-call state uses OUTBOX's blue rather than its
purple: the two need to stay apart at a glance.

## Tests

```bash
npm test
```

Thirty tests covering the transcript classifier, the AMD state machine and its
timers, the batch race and abandoned-call path, HubSpot signature validation,
and lead queue throttling. None of them touch the network or need API keys.

## Compliance

This dials people. Before running it against a real list, understand your
obligations under the TCPA and your state's equivalents: consent, calling hours,
the National Do Not Call Registry, caller ID accuracy, abandonment rate caps,
and call recording consent in two-party states. The abandoned-call message and
the per-session abandonment counter are here to help you stay inside those
rules, not to substitute for knowing them.

## License

MIT
