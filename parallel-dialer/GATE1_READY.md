# Gate 1 readiness: the first real call

Checked 2026-11-08, branch `feat/gate1-prep`, based on `origin/master` 52edb8a17 (includes #21 phone-bridge and #24).
The carrier is **SignalWire**. On `master` the code default is still `twilio`, so Railway **must** set `TELEPHONY_PROVIDER=signalwire`.
**No real call has been placed.** Every item below about live behaviour is still unproven (see `codex-handover.md`, Gate 1).

What was checked:
- **Key names:** `md-secret list` (empty) and `~/Desktop/A305 Dialer/env.txt` (3 names). No values were printed.
- **SignalWire:** read-only API calls using the env.txt credentials, re-run 2026-11-08 (`npm run preflight:gate1`). Account API 200, Calls API 200, phone-numbers API 401. No calls were placed, nothing was bought.
- **Not checked (no access from here):** whether a Railway service, Deepgram account or HubSpot private app already exists. Marked MISSING because no key for them exists in either source.

## 1. Checklist

### SignalWire (the carrier)

| Item | Env var | Status | Notes |
| --- | --- | --- | --- |
| Project ID | `SIGNALWIRE_PROJECT_ID` | **HAVE** | In env.txt. Valid: the account API returned 200. |
| API token | `SIGNALWIRE_API_TOKEN` | **HAVE** | In env.txt. It has the Voice scope (Calls API returned 200). It **lacks the Numbers scope** (phone-numbers API returned 401). That doesn't block calls; it only stops the preflight from confirming the caller ID. |
| Space host | `SIGNALWIRE_SPACE_URL` | **HAVE** | env.txt stores it as `SIGNALWIRE_SPACE`. The code now accepts that name too. Format is right: no scheme, full `*.signalwire.com` host. |
| Caller ID (a SignalWire number) | `SIGNALWIRE_CALLER_ID` | **MISSING** | Buy a voice-capable number in Dashboard → Phone Numbers (costs money, so Cam does it). Use E.164 format, e.g. `+1305…`. Boot fails without it. |
| Signing Key | `SIGNALWIRE_SIGNING_KEY` | **MISSING** | Dashboard → API Credentials → Signing Key → Show. Without it, signatures are checked against the API token. If the two differ, every cXML webhook gets a 403 and the call dies on answer. Stopgap for the first call only: `SIGNALWIRE_VALIDATE_SIGNATURE=false`. |
| Agent bridge target | `AGENT_PHONE_NUMBER` | **MISSING** (recommended) | Phone-bridge mode: the answered call is bridged to Cam's own phone. This is the lowest-risk first call because it needs no SIP Endpoint and no browser audio. |
| SIP Endpoint (browser softphone) | `SIGNALWIRE_SIP_ENDPOINT_USERNAME` / `_PASSWORD` | MISSING (optional for Gate 1) | Dashboard → Voice → SIP Endpoints. The username must equal `DIALER_AGENT_IDENTITY` (`agent_1`). Not needed if `AGENT_PHONE_NUMBER` is set. Browser registration over WSS has never been tested live. |

### Deepgram (answer detection)

| Item | Env var | Status | Notes |
| --- | --- | --- | --- |
| API key | `DEEPGRAM_API_KEY` | **MISSING** | console.deepgram.com → API Keys (Member role is enough). Without it, answer detection only uses timeouts. The free signup credit covers Gate 1. |

### HubSpot (CRM logging)

| Item | Env var | Status | Notes |
| --- | --- | --- | --- |
| Private app token | `HUBSPOT_ACCESS_TOKEN` | **MISSING** | Settings → Integrations → Private Apps. Scopes: `crm.objects.contacts.read/write` and `crm.objects.calls.read/write`. |
| App client secret | `HUBSPOT_CLIENT_SECRET` | MISSING (not needed for the first call) | Only the inbound lead webhook uses it. |
| A test contact | n/a | **MISSING** | A HubSpot contact whose phone equals the test number you dial. Otherwise the Call engagement has no contact to attach to. |

### Deployment and app

| Item | Env var | Status | Notes |
| --- | --- | --- | --- |
| Railway service + volume at `/data` | n/a | **MISSING** | Follow `DEPLOY_RAILWAY.md` steps 1–3. Railway injects `RAILWAY_PUBLIC_DOMAIN`, so `PUBLIC_BASE_URL` can stay unset. |
| Dashboard / control key | `DIALER_API_KEY` | **MISSING** | Long random string: `openssl rand -hex 32`. Required in production. |
| Runtime | `NODE_ENV=production`, `CORS_ORIGINS=https://<domain>` | **MISSING** | |
| Durable paths | `AMD_AUDIT_PATH=/data/amd-audit.jsonl`, `WORKSPACE_DATA_DIR=/data/workspace`, `HUBSPOT_DEAD_LETTER_PATH=/data/crm-dead-letter.jsonl`, `HUBSPOT_OUTCOME_DEAD_LETTER_PATH=/data/crm-outcome-dead-letter.jsonl` | **MISSING** | |
| First-call mode | `DIALER_SCREENING=false`, `DIALER_BATCH_SIZE=1` | set per session | Power-dial mode: one line, and no answer-detection verdict can drop the call. The session request below sets both. |
| A phone to dial | n/a | **MISSING** | A second phone Cam owns (not `AGENT_PHONE_NUMBER`). Dial only numbers you control. |

| Provider switch | `TELEPHONY_PROVIDER=signalwire` | **MISSING** | Required: the code default on `master` is `twilio`, which would demand Twilio keys and fail boot. |

Twilio variables are not needed while `TELEPHONY_PROVIDER=signalwire`.
`DEPLOY_RAILWAY.md` §4 still lists the Twilio block. Use the SignalWire block below instead.

### Railway Variables for the first call

```
NODE_ENV=production
TELEPHONY_PROVIDER=signalwire
SIGNALWIRE_PROJECT_ID=<from env.txt>
SIGNALWIRE_API_TOKEN=<from env.txt>
SIGNALWIRE_SPACE_URL=<SIGNALWIRE_SPACE from env.txt>
SIGNALWIRE_CALLER_ID=+1...            # number bought on this project
SIGNALWIRE_SIGNING_KEY=<Dashboard → API Credentials>
AGENT_PHONE_NUMBER=+1...              # Cam's phone that takes the bridged call
DEEPGRAM_API_KEY=...
HUBSPOT_ACCESS_TOKEN=pat-...
DIALER_API_KEY=<openssl rand -hex 32>
CORS_ORIGINS=https://<railway-domain>
AMD_AUDIT_PATH=/data/amd-audit.jsonl
WORKSPACE_DATA_DIR=/data/workspace
HUBSPOT_DEAD_LETTER_PATH=/data/crm-dead-letter.jsonl
HUBSPOT_OUTCOME_DEAD_LETTER_PATH=/data/crm-outcome-dead-letter.jsonl
```

## 2. Smoke test

### Step A: preflight (no call, no spend)

Run this with the same values in a local `.env`, or exported in the shell:

```bash
cd parallel-dialer
PUBLIC_BASE_URL=https://<railway-domain> npm run preflight:gate1
```

It makes read-only requests to check:
- the boot config (prints missing vars and boot warnings)
- SignalWire auth, Voice scope and caller-ID ownership
- the Deepgram key
- the HubSpot contacts and calls scopes
- the deployment's `/health`

It exits 1 on any FAIL and never prints a secret.
Today, with only env.txt loaded, it shows PASS for SignalWire credentials and Voice scope, and FAIL for the caller ID, Deepgram, HubSpot and the HTTPS URL.

Also check the Railway deploy log for the boot line `parallel dialer listening` and make sure it shows no warnings.

### Step B: one real call (Cam runs this; it spends a few cents)

```bash
export DIALER=https://<railway-domain>
export DIALER_API_KEY=...            # same value as Railway
export TEST_LEAD=+1...               # a second phone Cam owns

# 1. Watch events in one terminal
curl -N -H "x-dialer-key: $DIALER_API_KEY" "$DIALER/api/events"

# 2. In another terminal, start a one-line power-dial session
curl -sS -X POST "$DIALER/api/sessions" \
  -H 'Content-Type: application/json' \
  -H "x-dialer-key: $DIALER_API_KEY" \
  -d "{\"agentIdentity\":\"agent_1\",\"batchSize\":1,\"screening\":false,
       \"leads\":[{\"phone\":\"$TEST_LEAD\",\"name\":\"Gate1 Test\"}]}"
```

Answer `TEST_LEAD`. `AGENT_PHONE_NUMBER` should ring next. Answer it, talk both ways, then hang up.

After the connected call ends, a power-dial session goes to `PAUSED` (waits for an outcome). The `id` is in the JSON the POST returned. End it:

```bash
curl -sS -X DELETE -H "x-dialer-key: $DIALER_API_KEY" "$DIALER/api/sessions/<id>"
```

### What to record

| Gate 1 question | Where to look | Pass when |
| --- | --- | --- |
| Leg answers into the stream and audio arrives | SSE `leg:streaming`, Railway log for `/media-stream` | You see a `leg:streaming` event for the leg |
| Deepgram transcribes 8 kHz μ-law | `leg:classified` transcript, `/data/amd-audit.jsonl` | The transcript holds the words you said |
| Bridge lands before the human hangs up | SSE `leg:connected`, the agent phone rings | Two-way audio within a few seconds |
| Answer-detection latency | `classificationLatencyMs` in the audit row | A real number recorded (collect dozens later) |
| HubSpot engagement | The test contact's timeline | A Call shows with the right duration |
| Webhook signatures | Railway log: `rejected unsigned SignalWire webhook` | Never appears |

After that, the rest of Gate 1:
- a voicemail is classified MACHINE (`DIALER_SCREENING=true`)
- a 3-line batch bridges one leg and drops the others
- the browser SIP softphone, if wanted

## 3. Code gaps fixed on this branch

1. **Webhook signature key.**
   - Before: signatures were checked against the API token.
   - Problem: SignalWire signs with the separate project Signing Key. On any project where the two differ, every cXML webhook would get a 403, so the leg would get no TwiML and hang up.
   - Fix: added `SIGNALWIRE_SIGNING_KEY`. If it is unset, the token is used and a boot warning is printed.
2. **SIP domain.**
   - Before: `<Sip>` dialled `agent@{space}.signalwire.com`, the REST host.
   - Problem: SignalWire SIP Endpoints live at `{space}.sip.signalwire.com`.
   - Fix: the SIP domain is now derived from the space (override with `SIGNALWIRE_SIP_DOMAIN`). The browser SIP registration uses the same domain. That registration is still unverified live.
3. **`SIGNALWIRE_SPACE` alias.** The credentials were handed over under that name. The code also strips a stray `https://` or trailing `/`.
4. **Phone-bridge mode no longer warns about a missing SIP Endpoint.** It doesn't need one.
5. **New:** `scripts/gate1-preflight.mjs` (`npm run preflight:gate1`), a new config test, and `.env.example` documents the new vars.

These were first written on a stale copy (commit 39d8052, separate repo) and ported onto `origin/master`; they applied cleanly.

`npm test` in the agent sandbox: 123 tests, 118 pass. The 5 that fail are all in `test/operatorAuth.test.js` and fail with `listen EPERM` (the sandbox blocks local ports), not a code fault. Run `npm test` on a normal machine to confirm 123/123 before merging. `npm run build`: clean.

**Still unverified until a live call:**
- whether SignalWire's media-stream frames match Twilio's shape (`start.customParameters`, `media.payload`)
- the terminal error codes in `hangupCall`
- browser SIP over WSS

## 4. What Cam must supply

1. Buy a SignalWire number on this project. Give us the E.164 value for `SIGNALWIRE_CALLER_ID`.
2. The SignalWire **Signing Key**, for `SIGNALWIRE_SIGNING_KEY`.
3. Optional: add the Numbers scope to the API token, so the preflight can confirm the caller ID.
4. `AGENT_PHONE_NUMBER`: Cam's phone that takes the bridged call.
5. A second phone number Cam owns, to dial as the test lead.
6. A Deepgram API key.
7. A HubSpot private-app token (contacts + calls read/write), plus a test contact with the test lead's phone number.
8. The Railway service: GitHub source, root `parallel-dialer`, a volume at `/data`, a generated domain, and the variables above, including a fresh `DIALER_API_KEY`.
9. Then run Step A, then Step B.
