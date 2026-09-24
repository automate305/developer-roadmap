/**
 * server.js — Express entry point and HTTP/WebSocket server initialisation.
 *
 * Wires four surfaces onto one port:
 *   HTTP  /api/*                  control plane for the agent workstation
 *   HTTP  /twiml/*                Twilio voice webhooks
 *   HTTP  /api/webhooks/*         CRM webhooks (raw-body preserving)
 *   WS    /media-stream           Twilio Media Streams → Deepgram AMD
 *
 * A single `http.Server` handles both protocols so one public tunnel or one
 * load-balancer target covers the whole system.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import { WebSocketServer } from 'ws';

import { config, validateConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { dialerEngine } from './backend/dialerEngine.js';
import { handleMediaStreamConnection } from './backend/streamHandler.js';
import { logCallActivity, findCallByExternalId, isHubSpotConfigured } from './backend/hubspotService.js';
import { CallActivityQueue } from './backend/callActivityQueue.js';
import { createApiRouter } from './backend/routes/api.js';
import { createTwimlRouter } from './backend/routes/twiml.js';
import { createWebhookRouter } from './backend/routes/webhooks.js';

const log = logger.child({ module: 'server' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express app. Exported so integration tests can mount it without
 * binding a port.
 */
export function createApp({ engine = dialerEngine } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true); // behind ngrok / ALB / Cloudflare

  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : false,
      credentials: true,
      allowedHeaders: ['Content-Type', 'x-dialer-key'],
    }),
  );

  // Terse request log; TwiML and media traffic are logged by their own modules.
  app.use((req, _res, next) => {
    if (!req.path.startsWith('/assets')) log.trace('request', { method: req.method, path: req.path });
    next();
  });

  // ── CRM webhooks ─────────────────────────────────────────────────────────
  // The raw bytes must survive parsing: HubSpot's v3 signature covers the exact
  // body it sent, and re-serialising the parsed object changes key order.
  const { router: webhookRouter, leadQueue } = createWebhookRouter({ engine });
  app.use(
    '/api/webhooks',
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
    webhookRouter,
  );

  // ── Control plane + Twilio voice webhooks ────────────────────────────────
  app.use('/api', createApiRouter({ engine }));
  app.use('/twiml', createTwimlRouter({ engine }));

  // Convenience alias so infrastructure health checks need no /api prefix.
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  // ── Built agent workstation (npm run build:web) ──────────────────────────
  const webRoot = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(webRoot, { index: false, fallthrough: true }));
  app.get(/^\/(?!api|twiml|media-stream).*/, (_req, res, next) => {
    res.sendFile(path.join(webRoot, 'index.html'), (err) => {
      // No build present (API-only deployment) — fall through to the 404.
      if (err) next();
    });
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  // eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
  app.use((err, _req, res, _next) => {
    log.error('unhandled request error', { err });
    res.status(500).json({ error: 'internal_error' });
  });

  app.locals.leadQueue = leadQueue;
  return app;
}

/**
 * Attach the Media Stream WebSocket server to an existing HTTP server.
 *
 * `noServer: true` plus a manual `upgrade` handler means only `/media-stream`
 * is upgraded; every other upgrade attempt is rejected rather than silently
 * accepted, which keeps stray clients off the audio path.
 */
export function attachMediaStreamServer(server, { engine = dialerEngine } = {}) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    if (pathname !== '/media-stream') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    log.debug('media stream connection opened', { remote: req.socket.remoteAddress });
    // Compression is off: μ-law frames are tiny and already incompressible;
    // deflate would only add per-frame latency.
    handleMediaStreamConnection(ws, req, { engine });
  });

  wss.on('error', (err) => log.error('media stream server error', { err }));

  return wss;
}

/**
 * Post-call CRM logging. Bound to `leg:ended` rather than awaited inline in the
 * engine so a slow HubSpot write can never delay the next batch.
 *
 * Writes go through a durable retry queue: transient failures back off and try
 * again, retries are de-duplicated against the existing engagement, and
 * anything that still fails is written to a dead-letter file rather than lost.
 *
 * @returns {CallActivityQueue|null} the queue, so shutdown can flush it
 */
function attachCrmLogging(engine) {
  if (!isHubSpotConfigured()) {
    log.warn('HubSpot not configured — call activities will not be logged');
    return null;
  }

  const queue = new CallActivityQueue({
    submit: (payload) => logCallActivity(payload),
    findExisting: (callSid) => findCallByExternalId(callSid),
    deadLetterPath: config.hubspot.deadLetterPath,
  });

  queue.on('dead-letter', ({ payload, reason }) => {
    log.error('call activity could not be written to HubSpot', { callSid: payload?.callSid, reason });
  });

  engine.on('leg:ended', (leg) => {
    // Legs that never connected to a carrier have nothing worth a timeline entry.
    if (!leg.callSid) return;

    queue.enqueue({
      contactId: leg.contactId,
      phone: leg.phone,
      durationSeconds: leg.durationSeconds,
      disposition: leg.disposition ?? 'FAILED',
      transcript: leg.transcript,
      callSid: leg.callSid,
      // The agent who actually took this leg, not the process default.
      agentIdentity: leg.agentIdentity ?? config.dialer.agentIdentity,
      timestamp: leg.answeredAt ?? Date.now(),
    });
  });

  return queue;
}

/** Boot the process. */
export async function start() {
  const { ok, missing, warnings } = validateConfig();
  for (const warning of warnings) log.warn(warning);
  if (!ok) {
    log.error('missing required configuration', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const app = createApp({ engine: dialerEngine });
  const server = http.createServer(app);

  // Twilio holds media sockets open for the life of a call; the default 5 s
  // header timeout would reap long-lived legs.
  server.keepAliveTimeout = 76000;
  server.headersTimeout = 80000;

  const wss = attachMediaStreamServer(server, { engine: dialerEngine });
  const crmQueue = attachCrmLogging(dialerEngine);

  // Anything stranded by a previous shutdown or outage goes back in first.
  if (crmQueue && config.hubspot.replayDeadLetterOnBoot) {
    crmQueue
      .replayDeadLetter()
      .then((replayed) => {
        if (replayed > 0) log.info('replayed dead-lettered call activities on boot', { replayed });
      })
      .catch((err) => log.warn('dead-letter replay failed', { err }));
  }

  // Reclaim finished batches so the in-memory indexes do not grow unbounded.
  const pruneTimer = setInterval(() => dialerEngine.pruneResolved(), 60000);
  pruneTimer.unref();

  await new Promise((resolve) => server.listen(config.port, resolve));

  log.info('parallel dialer listening', {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    mediaStreamUrl: `${config.publicWsUrl}/media-stream`,
    batchSize: config.dialer.batchSize,
    agentIdentity: config.dialer.agentIdentity,
    amd: config.amd,
  });

  const shutdown = async (signal) => {
    log.info('shutting down', { signal });
    clearInterval(pruneTimer);

    for (const socket of wss.clients) {
      try {
        socket.close(1001, 'server_shutdown');
      } catch { /* already gone */ }
    }

    await Promise.allSettled(
      dialerEngine.listSessions().map((session) => dialerEngine.stopSession(session.sessionId, 'server_shutdown')),
    );

    // Push any half-retried CRM writes to disk so the next boot can replay
    // them. Without this a SIGTERM mid-backoff loses those call records.
    if (crmQueue) {
      const stranded = await crmQueue.close();
      if (stranded > 0) log.warn('flushed pending call activities to dead letter', { stranded });
    }

    server.close(() => process.exit(0));
    // Do not let a hung socket block the exit indefinitely.
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));

  return { app, server, wss };
}

// Only boot when executed directly, so tests can import `createApp`.
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  start().catch((err) => {
    log.error('failed to start', { err });
    process.exit(1);
  });
}

export default createApp;
