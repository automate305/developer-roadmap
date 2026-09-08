/**
 * callActivityQueue.js — durable retry queue for CRM call-activity writes.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Post-call logging used to be fire-and-forget: `logCallActivity()` returned
 * `{ ok: false }` on failure and the caller logged it. A HubSpot outage, a 429,
 * or a search-index lag on a freshly created contact silently destroyed the
 * record of a real conversation. Call records are the business output of a
 * dialer; losing them is worse than losing the call.
 *
 * ── Guarantees ───────────────────────────────────────────────────────────────
 *  1. Transient failures are retried with exponential backoff and jitter.
 *  2. Retries are idempotent. A write that succeeded but whose response was
 *     lost would otherwise be duplicated, so before every retry the queue looks
 *     for an existing Call carrying this `hs_call_external_id` and treats a hit
 *     as success.
 *  3. Nothing is dropped silently. Once attempts are exhausted — or the process
 *     is shutting down with work still pending — the payload is appended to a
 *     dead-letter file that `replayDeadLetter()` can feed back in.
 *  4. Terminal failures are not retried. A 400 will still be a 400 in an hour;
 *     it goes straight to the dead letter with its reason attached.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'callActivityQueue' });

/** Backoff schedule in ms. Five attempts spanning about six minutes. */
export const DEFAULT_BACKOFF_MS = [1_000, 4_000, 15_000, 60_000, 300_000];

/** HTTP statuses worth trying again. Everything else is the caller's fault. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Node network errors that mean "the request never landed". */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
]);

/**
 * Decide whether a failed CRM write is worth another attempt.
 * Exported so the policy is testable on its own.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableError(err) {
  if (!err) return false;

  // A string reason from logCallActivity rather than a thrown error.
  if (typeof err === 'string') return err === 'contact_not_found';

  const code = err.code ?? err.statusCode ?? err.status ?? err.response?.status;

  // Network-level failure: the write may never have reached HubSpot.
  if (typeof code === 'string') return RETRYABLE_NETWORK_CODES.has(code);
  if (typeof code === 'number') return RETRYABLE_STATUS.has(code);

  // A contact created moments ago may not be in the search index yet, so a
  // lookup miss is worth retrying — unlike a malformed request.
  if (err.reason === 'contact_not_found') return true;

  // No status at all usually means the request never completed.
  return true;
}

/**
 * Bounded, persistent retry queue for CRM writes.
 *
 * Emits: `logged` ({ payload, id }), `retry` ({ payload, attempt, delayMs }),
 * `dead-letter` ({ payload, reason }), `drain` (stats).
 */
export class CallActivityQueue extends EventEmitter {
  /**
   * @param {object} opts
   * @param {(payload: object) => Promise<{ ok: boolean, id?: string, reason?: string, error?: unknown }>} opts.submit
   *   Performs one write attempt.
   * @param {(callSid: string) => Promise<string|null>} [opts.findExisting]
   *   Idempotency probe: resolves to an existing engagement id, or null.
   * @param {string} [opts.deadLetterPath] file that exhausted payloads append to
   * @param {number[]} [opts.backoffMs] delay before each retry
   * @param {number} [opts.maxPending] queue ceiling before shedding to the dead letter
   * @param {(fn: () => void, ms: number) => unknown} [opts.schedule] injectable timer, for tests
   */
  constructor(opts) {
    super();
    if (typeof opts?.submit !== 'function') throw new Error('CallActivityQueue requires a submit function');

    this.submit = opts.submit;
    this.findExisting = opts.findExisting ?? null;
    this.deadLetterPath = opts.deadLetterPath ?? null;
    this.backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxPending = opts.maxPending ?? 5000;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms).unref?.());

    /** In-flight or waiting payloads, keyed by callSid (or a synthetic id). */
    /** @type {Map<string, { payload: object, attempt: number }>} */
    this.pending = new Map();
    this.closed = false;

    this.stats = {
      submitted: 0,
      logged: 0,
      retried: 0,
      deadLettered: 0,
      duplicatesAvoided: 0,
      shed: 0,
    };
  }

  get size() {
    return this.pending.size;
  }

  /**
   * Accept a call activity for writing. Returns immediately; the write happens
   * on a later tick so a slow CRM can never delay the dialer.
   * @param {object} payload arguments for `logCallActivity`
   */
  enqueue(payload) {
    if (this.closed) {
      void this.#deadLetter(payload, 'queue_closed');
      return false;
    }

    const key = payload.callSid ?? `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Same call already queued — the engine can emit `leg:ended` more than once
    // in edge cases and we must not write the activity twice.
    if (this.pending.has(key)) return false;

    if (this.pending.size >= this.maxPending) {
      // Shedding to disk beats unbounded memory growth, and the payload is
      // still replayable rather than lost.
      this.stats.shed += 1;
      log.warn('call activity queue full — shedding to dead letter', { pending: this.pending.size });
      void this.#deadLetter(payload, 'queue_full');
      return false;
    }

    this.pending.set(key, { payload, attempt: 0 });
    this.stats.submitted += 1;
    setImmediate(() => void this.#attempt(key));
    return true;
  }

  /**
   * One write attempt for a queued payload, plus the decision about what
   * happens next.
   */
  async #attempt(key) {
    const entry = this.pending.get(key);
    if (!entry) return;

    const { payload } = entry;
    entry.attempt += 1;
    const attempt = entry.attempt;

    // Idempotency: from the second attempt on, the previous one may have
    // succeeded with its response lost in transit. Check before writing again.
    if (attempt > 1 && this.findExisting && payload.callSid) {
      try {
        const existingId = await this.findExisting(payload.callSid);
        if (existingId) {
          this.stats.duplicatesAvoided += 1;
          log.info('call activity already present — skipping duplicate write', {
            callSid: payload.callSid,
            engagementId: existingId,
          });
          this.#settle(key, existingId);
          return;
        }
      } catch (err) {
        // A failed probe is not a reason to abandon the write; worst case we
        // create a duplicate, which is better than losing the record.
        log.debug('idempotency probe failed', { callSid: payload.callSid, err });
      }
    }

    let result;
    try {
      result = await this.submit(payload);
    } catch (err) {
      result = { ok: false, reason: err?.message ?? 'threw', error: err };
    }

    if (result?.ok) {
      this.#settle(key, result.id);
      return;
    }

    const cause = result?.error ?? result?.reason ?? 'unknown_error';
    const retryable = isRetryableError(result?.error ?? { reason: result?.reason });
    const attemptsLeft = attempt <= this.backoffMs.length;

    if (!retryable || !attemptsLeft) {
      this.pending.delete(key);
      await this.#deadLetter(payload, result?.reason ?? 'unknown_error', {
        attempts: attempt,
        retryable,
      });
      this.#maybeDrain();
      return;
    }

    const delayMs = this.#backoffFor(attempt);
    this.stats.retried += 1;
    this.emit('retry', { payload, attempt, delayMs, reason: result?.reason });
    log.warn('call activity write failed — retrying', {
      callSid: payload.callSid,
      attempt,
      delayMs,
      reason: result?.reason ?? String(cause),
    });

    this.schedule(() => void this.#attempt(key), delayMs);
  }

  /** Backoff for `attempt` (1-based), with jitter to avoid a thundering herd. */
  #backoffFor(attempt) {
    const base = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)];
    // ±20% jitter. Batches fail together, so they must not retry together.
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  #settle(key, id) {
    const entry = this.pending.get(key);
    this.pending.delete(key);
    this.stats.logged += 1;
    this.emit('logged', { payload: entry?.payload, id });
    this.#maybeDrain();
  }

  #maybeDrain() {
    if (this.pending.size === 0) this.emit('drain', { ...this.stats });
  }

  /**
   * Append a payload to the dead-letter file so it survives the process.
   * If the file cannot be written, log loudly — this is the last line of
   * defense and a silent failure here is exactly what the queue exists to stop.
   */
  async #deadLetter(payload, reason, meta = {}) {
    this.stats.deadLettered += 1;

    // Persist before emitting: subscribers treat `dead-letter` as "this record
    // is now durable", and firing first would let them read a file that has
    // not been written yet. `persisted` says whether that promise held.
    let persisted = false;
    if (this.deadLetterPath) {
      const record = JSON.stringify({ at: new Date().toISOString(), reason, ...meta, payload });
      try {
        await fs.mkdir(path.dirname(this.deadLetterPath), { recursive: true });
        await fs.appendFile(this.deadLetterPath, `${record}\n`, 'utf8');
        persisted = true;
      } catch (err) {
        log.error('FAILED TO WRITE DEAD LETTER — call record is lost', {
          callSid: payload?.callSid,
          deadLetterPath: this.deadLetterPath,
          err,
        });
      }
    }

    log.error('call activity dead-lettered', { callSid: payload?.callSid, reason, persisted, ...meta });
    this.emit('dead-letter', { payload, reason, persisted, ...meta });
  }

  /**
   * Re-enqueue everything in the dead-letter file, then truncate it. Anything
   * that fails again lands back in a freshly written file.
   * @returns {Promise<number>} how many payloads were re-enqueued
   */
  async replayDeadLetter() {
    if (!this.deadLetterPath) return 0;

    let contents;
    try {
      contents = await fs.readFile(this.deadLetterPath, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return 0;
      throw err;
    }

    const lines = contents.split('\n').filter((line) => line.trim());
    // Truncate first: a payload re-enqueued below may fail and append again,
    // and clearing afterwards would erase that fresh entry.
    await fs.writeFile(this.deadLetterPath, '', 'utf8');

    let replayed = 0;
    for (const line of lines) {
      try {
        const { payload } = JSON.parse(line);
        if (payload && this.enqueue(payload)) replayed += 1;
      } catch {
        log.warn('skipping unparseable dead-letter line');
      }
    }

    log.info('replayed dead-lettered call activities', { replayed, found: lines.length });
    return replayed;
  }

  /**
   * Stop accepting work and push anything still pending to the dead letter, so
   * a shutdown mid-retry does not lose records. Call this from SIGTERM.
   */
  async close() {
    this.closed = true;
    const stranded = [...this.pending.values()];
    this.pending.clear();

    for (const { payload, attempt } of stranded) {
      await this.#deadLetter(payload, 'shutdown_with_pending_writes', { attempts: attempt });
    }

    return stranded.length;
  }
}

export default CallActivityQueue;
