/**
 * Durable CRM write queue.
 *
 * The backoff timer is injected so the whole suite runs instantly, and the
 * dead-letter file goes to a temp directory that is cleaned up after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { CallActivityQueue, isRetryableError } from '../src/backend/callActivityQueue.js';

let tmpDir;
before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dialer-dlq-'));
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Run scheduled retries immediately, preserving order. */
const immediate = (fn) => setImmediate(fn);

/** Resolve once the queue empties. */
function drained(queue) {
  return new Promise((resolve) => queue.once('drain', resolve));
}

const PAYLOAD = { callSid: 'CA123', phone: '+13055550101', disposition: 'HUMAN' };

describe('isRetryableError', () => {
  it('retries transient HTTP statuses', () => {
    for (const code of [408, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableError({ code }), true, `expected ${code} retryable`);
    }
  });

  it('does not retry client errors', () => {
    for (const code of [400, 401, 403, 404, 422]) {
      assert.equal(isRetryableError({ code }), false, `expected ${code} terminal`);
    }
  });

  it('retries network-level failures', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
      assert.equal(isRetryableError({ code }), true, `expected ${code} retryable`);
    }
  });

  it('retries a contact that is not in the search index yet', () => {
    assert.equal(isRetryableError({ reason: 'contact_not_found' }), true);
  });

  it('reads a status from any of the shapes the SDK throws', () => {
    assert.equal(isRetryableError({ statusCode: 429 }), true);
    assert.equal(isRetryableError({ response: { status: 503 } }), true);
    assert.equal(isRetryableError({ response: { status: 400 } }), false);
  });
});

describe('CallActivityQueue', () => {
  it('writes once on the happy path', async () => {
    const calls = [];
    const queue = new CallActivityQueue({
      submit: async (payload) => {
        calls.push(payload);
        return { ok: true, id: 'eng_1' };
      },
      schedule: immediate,
    });

    const done = drained(queue);
    queue.enqueue(PAYLOAD);
    await done;

    assert.equal(calls.length, 1);
    assert.equal(queue.stats.logged, 1);
    assert.equal(queue.stats.retried, 0);
  });

  it('retries a transient failure and succeeds', async () => {
    let attempts = 0;
    const queue = new CallActivityQueue({
      submit: async () => {
        attempts += 1;
        if (attempts < 3) return { ok: false, reason: 'rate limited', error: { code: 429 } };
        return { ok: true, id: 'eng_2' };
      },
      schedule: immediate,
    });

    const done = drained(queue);
    queue.enqueue(PAYLOAD);
    await done;

    assert.equal(attempts, 3);
    assert.equal(queue.stats.logged, 1);
    assert.equal(queue.stats.retried, 2);
    assert.equal(queue.stats.deadLettered, 0);
  });

  it('does not retry a terminal failure', async () => {
    let attempts = 0;
    const deadLetterPath = path.join(tmpDir, 'terminal.jsonl');
    const queue = new CallActivityQueue({
      submit: async () => {
        attempts += 1;
        return { ok: false, reason: 'bad request', error: { code: 400 } };
      },
      deadLetterPath,
      schedule: immediate,
    });

    const dead = new Promise((resolve) => queue.once('dead-letter', resolve));
    queue.enqueue(PAYLOAD);
    await dead;

    assert.equal(attempts, 1, 'a 400 must not be retried');
    assert.equal(queue.stats.deadLettered, 1);
  });

  it('dead-letters to disk after exhausting attempts, and can replay it', async () => {
    const deadLetterPath = path.join(tmpDir, 'exhausted.jsonl');
    let failing = true;
    let attempts = 0;

    const queue = new CallActivityQueue({
      submit: async () => {
        attempts += 1;
        if (failing) return { ok: false, reason: 'server error', error: { code: 503 } };
        return { ok: true, id: 'eng_3' };
      },
      deadLetterPath,
      backoffMs: [1, 1],
      schedule: immediate,
    });

    const dead = new Promise((resolve) => queue.once('dead-letter', resolve));
    queue.enqueue(PAYLOAD);
    await dead;

    // 1 initial attempt + 2 retries from the two-entry backoff schedule.
    assert.equal(attempts, 3);

    const written = await fs.readFile(deadLetterPath, 'utf8');
    const record = JSON.parse(written.trim());
    assert.equal(record.payload.callSid, 'CA123');
    assert.equal(record.reason, 'server error');

    // Now HubSpot recovers and the operator replays the file.
    failing = false;
    const replayDone = drained(queue);
    const replayed = await queue.replayDeadLetter();
    await replayDone;

    assert.equal(replayed, 1);
    assert.equal(queue.stats.logged, 1);
    assert.equal(await fs.readFile(deadLetterPath, 'utf8'), '', 'file should be cleared after a successful replay');
  });

  it('skips the write when a retry finds the engagement already exists', async () => {
    let attempts = 0;
    const queue = new CallActivityQueue({
      submit: async () => {
        attempts += 1;
        // First attempt "succeeded" server-side but the response was lost.
        return { ok: false, reason: 'socket hang up', error: { code: 'ECONNRESET' } };
      },
      findExisting: async (callSid) => (callSid === 'CA123' ? 'eng_existing' : null),
      backoffMs: [1, 1],
      schedule: immediate,
    });

    const done = drained(queue);
    queue.enqueue(PAYLOAD);
    await done;

    assert.equal(attempts, 1, 'the probe should stop a second write');
    assert.equal(queue.stats.duplicatesAvoided, 1);
    assert.equal(queue.stats.logged, 1);
    assert.equal(queue.stats.deadLettered, 0);
  });

  it('still writes when the idempotency probe itself fails', async () => {
    let attempts = 0;
    const queue = new CallActivityQueue({
      submit: async () => {
        attempts += 1;
        if (attempts === 1) return { ok: false, reason: 'timeout', error: { code: 'ETIMEDOUT' } };
        return { ok: true, id: 'eng_4' };
      },
      findExisting: async () => {
        throw new Error('search unavailable');
      },
      backoffMs: [1],
      schedule: immediate,
    });

    const done = drained(queue);
    queue.enqueue(PAYLOAD);
    await done;

    assert.equal(attempts, 2, 'a broken probe must not abandon the write');
    assert.equal(queue.stats.logged, 1);
  });

  it('ignores a duplicate enqueue for a call already in flight', () => {
    const queue = new CallActivityQueue({
      submit: async () => new Promise(() => {}), // never settles
      schedule: immediate,
    });

    assert.equal(queue.enqueue(PAYLOAD), true);
    assert.equal(queue.enqueue(PAYLOAD), false);
    assert.equal(queue.size, 1);
  });

  it('sheds to the dead letter rather than growing without bound', async () => {
    const deadLetterPath = path.join(tmpDir, 'shed.jsonl');
    const queue = new CallActivityQueue({
      submit: async () => new Promise(() => {}),
      deadLetterPath,
      maxPending: 2,
      schedule: immediate,
    });

    queue.enqueue({ callSid: 'CA1' });
    queue.enqueue({ callSid: 'CA2' });
    const dead = new Promise((resolve) => queue.once('dead-letter', resolve));
    queue.enqueue({ callSid: 'CA3' });
    await dead;

    assert.equal(queue.size, 2);
    assert.equal(queue.stats.shed, 1);
    const written = await fs.readFile(deadLetterPath, 'utf8');
    assert.match(written, /CA3/);
  });

  it('flushes pending writes to the dead letter on shutdown', async () => {
    const deadLetterPath = path.join(tmpDir, 'shutdown.jsonl');
    const queue = new CallActivityQueue({
      submit: async () => new Promise(() => {}),
      deadLetterPath,
      schedule: immediate,
    });

    queue.enqueue({ callSid: 'CA_pending' });
    const stranded = await queue.close();

    assert.equal(stranded, 1);
    const written = await fs.readFile(deadLetterPath, 'utf8');
    assert.match(written, /CA_pending/);
    assert.match(written, /shutdown_with_pending_writes/);
    // A closed queue refuses new work rather than accepting what it cannot flush.
    assert.equal(queue.enqueue({ callSid: 'CA_after' }), false);
  });
});
