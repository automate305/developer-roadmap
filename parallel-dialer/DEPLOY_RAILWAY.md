# Deploying the dialer to Railway

Railway is the right shape for this service and Vercel is not: the backend holds
a long-lived WebSocket per live call (Twilio Media Streams) and keeps in-memory
state for every batch in flight. That needs a persistent process, not a function.

One service runs both halves. `npm run build` emits the React workstation to
`dist/`, and `src/server.js` serves those static files alongside the API, the
TwiML webhooks, and the `/media-stream` socket — so there is nothing to deploy
separately and no cross-origin hop.

---

## 1. Create the service

New Project → Deploy from GitHub → `automate305/developer-roadmap`.

Then, in **Settings → Source**, set:

| Setting | Value |
| --- | --- |
| Root Directory | `parallel-dialer` |
| Branch | whichever branch you are deploying |

Everything else is read from `parallel-dialer/railway.json`: Nixpacks build,
`npm ci && npm run build`, start with `npm start`, health check on `/health`,
restart on failure.

**Leave replicas at 1.** Sessions, batches and legs live in process memory, so a
second replica would answer a status callback for a call it has never heard of.
Horizontal scaling needs shared state first — it is Gate 3.3 in
`DEV_ACTIONS_FINAL.md`.

## 2. Attach a volume — do not skip this

**Settings → Volumes → New Volume**, mount path `/data`.

Without it, failed CRM writes land on the container's ephemeral layer and are
erased by the next deploy. That silently undoes the durability guarantee the
dead-letter queue exists to provide. The app warns loudly at boot if the path
looks ephemeral in production, but the volume is the actual fix.

## 3. Generate the domain

**Settings → Networking → Generate Domain.**

You do not need to set `PUBLIC_BASE_URL`. Railway injects
`RAILWAY_PUBLIC_DOMAIN`, and the app derives both the HTTPS callback base and
the `wss://` Media Stream origin from it. Set `PUBLIC_BASE_URL` explicitly only
when you put a custom domain in front — it takes precedence.

## 4. Environment variables

Set these in **Variables**. `PORT` and `RAILWAY_PUBLIC_DOMAIN` are injected by
the platform; do not set them yourself.

```
NODE_ENV=production
LOG_LEVEL=info

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_CALLER_ID=+1305...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_TWIML_APP_SID=AP...

DEEPGRAM_API_KEY=...

HUBSPOT_ACCESS_TOKEN=pat-...
HUBSPOT_CLIENT_SECRET=...
HUBSPOT_DEAD_LETTER_PATH=/data/crm-dead-letter.jsonl

DIALER_API_KEY=<a long random string>
DIALER_AGENT_IDENTITY=agent_1
CORS_ORIGINS=https://<your-railway-domain>
```

`DIALER_API_KEY` is the only thing standing in front of the control plane, which
can start outbound calls. Treat it like a password, not a formality.

## 5. Point Twilio at it

With the domain live, in the Twilio console:

- **TwiML App** → Voice Request URL →
  `https://<domain>/twiml/agent-outbound` (POST)

And in HubSpot, the lead webhook target:

- `https://<domain>/api/webhooks/hubspot-lead` (POST)

Outbound call and status callbacks need no console configuration — the dialer
passes absolute URLs on each `calls.create`, built from the same derived base.

## 6. Verify the deploy

```bash
curl https://<domain>/health
# {"status":"ok","uptimeSeconds":...}
```

Then open `https://<domain>` and click **Go online**. A `READY` badge means the
token endpoint, the Twilio credentials and the WebRTC registration all work.

Check the deploy logs for the boot line and act on any warning it prints:

```
parallel dialer listening  {"publicBaseUrl":"https://<domain>", "mediaStreamUrl":"wss://<domain>/media-stream", ...}
```

If `publicBaseUrl` is not the domain Twilio can reach, nothing downstream will
work — signature validation rejects the webhooks and the media stream never
connects.

## 7. After it is up

Gate 1 in `DEV_ACTIONS_FINAL.md` is the next step: dial your own phone, confirm
audio reaches `/media-stream`, then confirm one leg of a three-line batch
bridges and the other two drop. Only call numbers you control.

Watch `/data/crm-dead-letter.jsonl`. A non-empty file means real conversations
are missing from HubSpot.
