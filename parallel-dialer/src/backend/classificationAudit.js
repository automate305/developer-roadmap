/**
 * classificationAudit.js — an append-only record of every AMD decision.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The dialer can only ever observe one of its two error types.
 *
 *   A false HUMAN is visible: the agent picks up and hears a recording.
 *   A false MACHINE is invisible: the leg was hung up, so nobody ever finds out
 *   it was a person. Same for a false NO_ANSWER.
 *
 * That asymmetry quietly poisons any attempt to tune the thresholds from
 * production behaviour. Tightening toward MACHINE looks free, because the cost
 * of tightening is the one number the system never sees. You end up confident,
 * well-tuned, and wrong.
 *
 * So every decision is written down with the evidence that produced it and the
 * exact configuration in force at the time. A human can then label a sample of
 * the invisible half, and `scripts/score-amd.mjs` turns the result into the
 * confusion matrix the live system cannot produce on its own.
 *
 * ── Hot path ─────────────────────────────────────────────────────────────────
 * Nothing here runs inside the classification path. The auditor subscribes to
 * the engine's existing `leg:classified` event, so the winner race in
 * `dialerEngine.#claimWinner` is untouched and stays synchronous.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { HUMAN_GREETINGS, HUMAN_MAX_WORDS, MACHINE_PATTERNS } from './streamHandler.js';

const log = logger.child({ module: 'classificationAudit' });

/**
 * Fingerprint of everything that determines a verdict: the timers, the word
 * ceiling, and both pattern lists.
 *
 * Records carrying different fingerprints were produced by different
 * classifiers and must not be pooled — a threshold change makes every earlier
 * decision an answer to a different question. The patterns are hashed from
 * their live sources rather than a hand-maintained version number, because a
 * version number drifts the first time someone edits a regex and forgets.
 *
 * @returns {string} 12 hex characters
 */
export function amdConfigFingerprint() {
  const material = JSON.stringify({
    initialSpeechTimeoutMs: config.amd.initialSpeechTimeoutMs,
    maxContinuousSpeechMs: config.amd.maxContinuousSpeechMs,
    decisionDeadlineMs: config.amd.decisionDeadlineMs,
    humanMaxWords: HUMAN_MAX_WORDS,
    machine: MACHINE_PATTERNS.map((r) => r.source),
    human: HUMAN_GREETINGS.map((r) => r.source),
  });
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 12);
}

/**
 * Build the record written for one decision.
 * Exported so its shape can be tested without touching the filesystem.
 *
 * @param {object} leg a `leg:classified` payload
 * @param {string} fingerprint from `amdConfigFingerprint()`
 */
export function buildAuditRecord(leg, fingerprint) {
  return {
    at: new Date().toISOString(),
    configHash: fingerprint,

    legId: leg.legId ?? null,
    callSid: leg.callSid ?? null,
    batchId: leg.batchId ?? null,

    classification: leg.classification ?? null,
    // False for a HUMAN that lost the race — an abandoned call, and the one
    // case where a correct verdict still produced a bad outcome.
    won: leg.won ?? null,
    reason: leg.classificationReason ?? null,
    latencyMs: leg.classificationLatencyMs ?? null,

    // The evidence a labeller reads to decide whether the verdict was right.
    transcript: leg.transcript ?? '',

    /**
     * Ground truth. Null until a human fills it in — which is the entire point:
     * for MACHINE and NO_ANSWER this is the only way the outcome is ever known.
     * Expected values: "HUMAN", "MACHINE", "NO_ANSWER".
     */
    actual: null,
  };
}

/**
 * Append-only JSONL audit log.
 *
 * Writes are serialised through one promise chain so concurrent decisions in a
 * batch cannot interleave a half-written line, and a failure is logged rather
 * than thrown — losing an audit line must never disturb a call.
 */
export class AmdAuditLog {
  /**
   * @param {object} [opts]
   * @param {string} [opts.filePath] destination; audit is disabled when absent
   * @param {string} [opts.fingerprint] override, for tests
   */
  constructor(opts = {}) {
    this.filePath = opts.filePath ?? null;
    this.fingerprint = opts.fingerprint ?? null;
    this.stats = { written: 0, failed: 0 };
    /** Serialises appends; also what `flush()` awaits. */
    this.tail = Promise.resolve();
  }

  get enabled() {
    return Boolean(this.filePath);
  }

  /** Computed lazily so tests can construct without loading config. */
  get configHash() {
    if (!this.fingerprint) this.fingerprint = amdConfigFingerprint();
    return this.fingerprint;
  }

  /**
   * Record one decision. Returns immediately; the write happens on the chain.
   * @param {object} leg a `leg:classified` payload
   */
  record(leg) {
    if (!this.enabled) return null;

    const record = buildAuditRecord(leg, this.configHash);
    this.tail = this.tail.then(() => this.#append(record)).catch(() => {});
    return record;
  }

  async #append(record) {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
      this.stats.written += 1;
    } catch (err) {
      this.stats.failed += 1;
      log.warn('failed to write AMD audit record', { legId: record.legId, err });
    }
  }

  /**
   * Await every queued write.
   *
   * Bounded, because this runs on the shutdown path: a filesystem call can hang
   * rather than fail on a pathological mount, and an audit flush must never be
   * the thing that stops a process exiting.
   *
   * @param {number} [timeoutMs]
   */
  async flush(timeoutMs = 5000) {
    let timer;
    const bound = new Promise((resolve) => {
      // Deliberately not unref'd: an unref'd timer can be skipped when the loop
      // drains, which is precisely the case this bound exists to cover. It is
      // cleared on the normal path, so it never holds the process open.
      timer = setTimeout(() => {
        log.warn('AMD audit flush timed out — some records may be unwritten', { timeoutMs });
        resolve();
      }, timeoutMs);
    });

    await Promise.race([this.tail, bound]);
    clearTimeout(timer);
    return { ...this.stats };
  }
}

/**
 * Subscribe an audit log to the engine.
 * @param {import('node:events').EventEmitter} engine
 * @param {AmdAuditLog} auditLog
 */
export function attachClassificationAudit(engine, auditLog) {
  if (!auditLog?.enabled) return null;

  engine.on('leg:classified', (leg) => auditLog.record(leg));

  log.info('AMD decisions are being audited', {
    filePath: auditLog.filePath,
    configHash: auditLog.configHash,
  });
  return auditLog;
}

export default AmdAuditLog;
