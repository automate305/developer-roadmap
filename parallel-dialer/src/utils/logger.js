/**
 * Dependency-free structured logger.
 *
 * Emits one JSON object per line so the output drops straight into
 * CloudWatch/Datadog/Loki without a parsing sidecar. Call-scoped context
 * (batchId, callSid) is carried by child loggers so a whole batch can be
 * reconstructed with a single grep.
 */
import { config } from '../config/env.js';

const LEVELS = { error: 10, warn: 20, info: 30, debug: 40, trace: 50 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/** Values that must never reach the log stream. */
const REDACT_KEYS = new Set([
  'authToken',
  'apiKey',
  'apiKeySecret',
  'accessToken',
  'clientSecret',
  'token',
  'signature',
  'authorization',
  'password',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACT_KEYS.has(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function write(level, context, message, meta) {
  if (LEVELS[level] > threshold) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact(context),
    ...(meta ? redact(meta) : {}),
  };

  let line;
  try {
    line = JSON.stringify(record);
  } catch {
    // Circular structures in `meta` must never take down a live call.
    line = JSON.stringify({ ts: record.ts, level, msg: message, meta: '[unserializable]' });
  }

  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/**
 * @param {Record<string, unknown>} [context] fields stamped on every record
 */
export function createLogger(context = {}) {
  return {
    error: (msg, meta) => write('error', context, msg, normalizeMeta(meta)),
    warn: (msg, meta) => write('warn', context, msg, normalizeMeta(meta)),
    info: (msg, meta) => write('info', context, msg, normalizeMeta(meta)),
    debug: (msg, meta) => write('debug', context, msg, normalizeMeta(meta)),
    trace: (msg, meta) => write('trace', context, msg, normalizeMeta(meta)),
    /** Derive a logger that inherits this context plus `extra`. */
    child: (extra) => createLogger({ ...context, ...extra }),
  };
}

/** Errors serialize to `{}` through JSON.stringify, so unwrap them first. */
function normalizeMeta(meta) {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return { err: { name: meta.name, message: meta.message, stack: meta.stack } };
  }
  if (meta.err instanceof Error) {
    return { ...meta, err: { name: meta.err.name, message: meta.err.message, stack: meta.err.stack } };
  }
  return meta;
}

export const logger = createLogger({ service: 'parallel-dialer' });
export default logger;
