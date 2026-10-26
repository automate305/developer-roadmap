/** Browser operator sessions. The API key stays server-side and is never
 * embedded in the Vite bundle or in an SSE URL. One process/replica is pinned
 * by railway.json, so sessions intentionally expire on a server restart. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

const COOKIE = 'a305_operator';
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function matches(presented, expected) {
  if (typeof presented !== 'string' || !presented || !expected) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createOperatorAuth({ key = config.dialerApiKey, publicBaseUrl = config.publicBaseUrl } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const cookieOptions = {
    httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: '/api', maxAge: SESSION_MS,
  };

  function sameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return false; // cookie-authenticated writes require a browser Origin
    const allowed = new Set([publicBaseUrl, ...config.corsOrigins]);
    return allowed.has(origin);
  }

  function sessionId(req) {
    const raw = req.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    return raw?.slice(COOKIE.length + 1);
  }

  function activeSession(req) {
    const id = sessionId(req);
    const expiry = sessions.get(id);
    if (!expiry) return false;
    if (expiry < Date.now()) {
      sessions.delete(id);
      return false;
    }
    return true;
  }

  function guard(req, res, next) {
    if (!key) return res.status(503).json({ error: 'operator_key_not_configured' });
    if (matches(req.get('x-dialer-key'), key)) return next();
    if (activeSession(req) && (['GET', 'HEAD'].includes(req.method) || sameOrigin(req))) return next();
    return res.status(401).json({ error: 'unauthorized' });
  }

  function status(req, res) {
    res.set('Cache-Control', 'no-store');
    res.json({ authenticated: activeSession(req) });
  }

  function login(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!key) return res.status(503).json({ error: 'operator_key_not_configured' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'invalid_origin' });
    const now = Date.now();
    const client = req.socket.remoteAddress ?? 'unknown'; // not spoofable via X-Forwarded-For
    const previous = attempts.get(client) ?? [];
    const recent = previous.filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)));
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    if (!matches(req.body?.key, key)) {
      attempts.set(client, [...recent, now]);
      return res.status(401).json({ error: 'unauthorized' });
    }
    attempts.delete(client);
    for (const [id, expiry] of sessions) if (expiry < now) sessions.delete(id);
    if (sessions.size >= 32) return res.status(503).json({ error: 'session_limit_reached' });
    const id = randomBytes(32).toString('hex');
    sessions.set(id, now + SESSION_MS);
    res.cookie(COOKIE, id, cookieOptions);
    return res.json({ authenticated: true });
  }

  function logout(req, res) {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'invalid_origin' });
    sessions.delete(sessionId(req));
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    return res.json({ authenticated: false });
  }

  return { guard, status, login, logout, isActive: activeSession };
}
