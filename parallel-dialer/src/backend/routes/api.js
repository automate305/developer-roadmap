/**
 * JSON control plane for the agent workstation: WebRTC tokens, session
 * control, and a Server-Sent Events feed of dialer activity.
 */
import express from 'express';

import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { dialerEngine, normalizeLead } from '../dialerEngine.js';
import { createVoiceAccessToken } from '../twilioClient.js';

const log = logger.child({ module: 'routes/api' });

/** Dialer events mirrored to the browser over SSE. */
const BROADCAST_EVENTS = [
  'session:started',
  'session:stopped',
  'session:exhausted',
  'session:error',
  'batch:started',
  'batch:connected',
  'batch:resolved',
  'leg:dialing',
  'leg:streaming',
  'leg:status',
  'leg:classified',
  'leg:connected',
  'leg:ended',
];

/**
 * Shared-secret guard for control endpoints. This is a stopgap, not real auth —
 * put your identity provider in front of these routes before production.
 */
function requireApiKey(req, res, next) {
  if (!config.dialerApiKey) return next();
  const presented = req.get('x-dialer-key') ?? req.query.key;
  if (presented !== config.dialerApiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

export function createApiRouter({ engine = dialerEngine } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  /** Liveness/readiness. Intentionally unauthenticated. */
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      activeSessions: engine.listSessions().length,
      version: process.env.npm_package_version ?? null,
    });
  });

  /**
   * Mint a Twilio Voice access token for the browser Device.
   * The identity here must match the `<Client>` the engine bridges onto.
   */
  router.get('/token', requireApiKey, (req, res) => {
    const identity = String(req.query.identity ?? config.dialer.agentIdentity);
    if (!/^[A-Za-z0-9_.\-]{1,121}$/.test(identity)) {
      return res.status(400).json({ error: 'invalid_identity' });
    }

    try {
      const payload = createVoiceAccessToken(identity);
      log.info('issued voice token', { identity, ttl: payload.expiresInSeconds });
      return res.json(payload);
    } catch (err) {
      log.error('token minting failed', { err });
      return res.status(500).json({ error: 'token_unavailable', message: err.message });
    }
  });

  /**
   * Start a dialing session.
   * Body: `{ agentIdentity?, leads: [string | {phone, contactId, name, company}],
   *   batchSize?, autoAdvance?, screening? }`
   *
   * `screening: false` with `batchSize: 1` is power-dial mode: one line, agent
   * bridged on answer, no AMD verdict acted on.
   */
  router.post('/sessions', requireApiKey, async (req, res) => {
    const { agentIdentity, leads, batchSize, autoAdvance, screening } = req.body ?? {};

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads_required' });
    }

    // Validate every lead up front so a single bad number does not leave a
    // half-dialed batch behind.
    try {
      leads.forEach(normalizeLead);
    } catch (err) {
      return res.status(400).json({ error: 'invalid_lead', message: err.message });
    }

    try {
      const session = await engine.startSession({
        agentIdentity, leads, batchSize, autoAdvance,
        ...(screening === undefined ? {} : { screening: Boolean(screening) }),
      });
      return res.status(201).json(session);
    } catch (err) {
      log.error('failed to start session', { err });
      return res.status(500).json({ error: 'session_start_failed', message: err.message });
    }
  });

  router.get('/sessions', requireApiKey, (_req, res) => {
    res.json({ sessions: engine.listSessions() });
  });

  router.get('/sessions/:id', requireApiKey, (req, res) => {
    const session = engine.snapshotSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not_found' });
    return res.json(session);
  });

  /** Stop a session and drop every live leg it owns. */
  router.delete('/sessions/:id', requireApiKey, async (req, res) => {
    const session = await engine.stopSession(req.params.id, 'stopped_by_agent');
    if (!session) return res.status(404).json({ error: 'not_found' });
    return res.json(session);
  });

  /**
   * Server-Sent Events feed of dialer activity for the workstation's log pane.
   * SSE rather than a second WebSocket: the flow is one-directional and this
   * survives proxies that mangle WS upgrades.
   */
  router.get('/events', requireApiKey, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // stop nginx buffering the stream
    });
    res.write('retry: 3000\n\n');

    const send = (event, payload) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* client vanished mid-write */
      }
    };

    const listeners = BROADCAST_EVENTS.map((event) => {
      const handler = (payload) => send(event, payload);
      engine.on(event, handler);
      return [event, handler];
    });

    // Comment frames keep intermediaries from reaping an idle connection.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 15000);

    send('connected', { at: Date.now() });

    req.on('close', () => {
      clearInterval(heartbeat);
      for (const [event, handler] of listeners) engine.off(event, handler);
      log.debug('sse client disconnected');
    });
  });

  return router;
}

export default createApiRouter;
