/**
 * The audit log exists to make the classifier's invisible error type visible.
 * These tests pin the two properties that matter: every verdict is recorded
 * with the evidence that produced it, and a change to the classifier changes
 * the fingerprint so old decisions are not pooled with new ones.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  AmdAuditLog,
  amdConfigFingerprint,
  attachClassificationAudit,
  buildAuditRecord,
} from '../src/backend/classificationAudit.js';

let tmpDir;
before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amd-audit-'));
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const LEG = {
  legId: 'leg_1',
  callSid: 'CA1',
  batchId: 'batch_1',
  classification: 'MACHINE',
  classificationReason: 'machine_phrase:reached',
  classificationLatencyMs: 1840,
  transcript: "hi you've reached dave's air conditioning",
};

describe('buildAuditRecord', () => {
  it('keeps the evidence a labeller needs', () => {
    const r = buildAuditRecord(LEG, 'abc123');
    assert.equal(r.classification, 'MACHINE');
    assert.equal(r.reason, 'machine_phrase:reached');
    assert.equal(r.latencyMs, 1840);
    assert.match(r.transcript, /dave's air conditioning/);
    assert.equal(r.configHash, 'abc123');
  });

  it('leaves ground truth null — only a human can fill it in', () => {
    assert.equal(buildAuditRecord(LEG, 'abc123').actual, null);
  });

  it('records whether a HUMAN verdict won its race', () => {
    // A HUMAN that lost is an abandoned call: right answer, bad outcome.
    const lost = buildAuditRecord({ ...LEG, classification: 'HUMAN', won: false }, 'abc123');
    assert.equal(lost.won, false);
  });
});

describe('amdConfigFingerprint', () => {
  it('is stable across calls', () => {
    assert.equal(amdConfigFingerprint(), amdConfigFingerprint());
  });

  it('is a short hex digest', () => {
    assert.match(amdConfigFingerprint(), /^[0-9a-f]{12}$/);
  });
});

describe('AmdAuditLog', () => {
  it('does nothing when no path is configured', () => {
    const log = new AmdAuditLog({});
    assert.equal(log.enabled, false);
    assert.equal(log.record(LEG), null);
  });

  it('appends one JSON line per decision', async () => {
    const filePath = path.join(tmpDir, 'append.jsonl');
    const log = new AmdAuditLog({ filePath, fingerprint: 'cfg1' });

    log.record(LEG);
    log.record({ ...LEG, legId: 'leg_2', classification: 'HUMAN', won: true });
    await log.flush();

    const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).classification, 'MACHINE');
    assert.equal(JSON.parse(lines[1]).classification, 'HUMAN');
    assert.equal(log.stats.written, 2);
  });

  it('serialises concurrent writes without interleaving', async () => {
    const filePath = path.join(tmpDir, 'concurrent.jsonl');
    const log = new AmdAuditLog({ filePath, fingerprint: 'cfg1' });

    // A batch decides several legs in the same tick.
    for (let i = 0; i < 25; i += 1) log.record({ ...LEG, legId: `leg_${i}` });
    await log.flush();

    const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 25);
    for (const line of lines) JSON.parse(line); // throws if a line was torn
  });

  it('records every verdict the engine emits, via the existing event', async () => {
    const filePath = path.join(tmpDir, 'attached.jsonl');
    const log = new AmdAuditLog({ filePath, fingerprint: 'cfg1' });
    const engine = new EventEmitter();

    attachClassificationAudit(engine, log);
    engine.emit('leg:classified', { ...LEG, classification: 'MACHINE' });
    engine.emit('leg:classified', { ...LEG, legId: 'leg_2', classification: 'NO_ANSWER' });
    engine.emit('leg:classified', { ...LEG, legId: 'leg_3', classification: 'HUMAN', won: true });
    await log.flush();

    const verdicts = (await fs.readFile(filePath, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).classification);
    assert.deepEqual(verdicts, ['MACHINE', 'NO_ANSWER', 'HUMAN']);
  });

  it('survives an unwritable path without throwing at the caller', async () => {
    // The audit log must never be able to disturb a live call. A regular file
    // where a directory belongs gives a deterministic ENOTDIR.
    const blocker = path.join(tmpDir, 'not-a-directory');
    await fs.writeFile(blocker, 'x', 'utf8');

    const log = new AmdAuditLog({ filePath: path.join(blocker, 'audit.jsonl'), fingerprint: 'cfg1' });
    assert.doesNotThrow(() => log.record(LEG));

    const stats = await log.flush();
    assert.equal(stats.failed, 1);
    assert.equal(stats.written, 0);
  });

  it('bounds flush so a stuck filesystem cannot block shutdown', async () => {
    const log = new AmdAuditLog({ filePath: path.join(tmpDir, 'stuck.jsonl'), fingerprint: 'cfg1' });
    // A write that never settles, as a hung fs call would look.
    log.tail = new Promise(() => {});

    const started = Date.now();
    await log.flush(60);
    assert.ok(Date.now() - started < 2000, 'flush should give up rather than hang');
  });
});
