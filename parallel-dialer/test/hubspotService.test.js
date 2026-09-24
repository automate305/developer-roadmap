/**
 * Signature validation and queue throttling. Both are security- or
 * capacity-relevant, so they are pinned without touching the network.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

import {
  LeadQueue,
  normalizePhone,
  verifySignatureV3,
  appendCallOutcome,
  buildOutcomeLine,
  AGENT_OUTCOME_LABELS,
} from '../src/backend/hubspotService.js';

const SECRET = 'test-client-secret';
const URI = 'https://dialer.example.com/api/webhooks/hubspot-lead';

function sign(method, uri, body, timestamp, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(`${method}${uri}${body}${timestamp}`, 'utf8').digest('base64');
}

describe('verifySignatureV3', () => {
  const body = JSON.stringify([{ objectId: 1, phone: '+13055550101' }]);

  it('accepts a correctly signed request', () => {
    const timestamp = String(Date.now());
    const result = verifySignatureV3({
      method: 'POST',
      uri: URI,
      rawBody: body,
      timestamp,
      signature: sign('POST', URI, body, timestamp),
      clientSecret: SECRET,
    });
    assert.equal(result.valid, true);
  });

  it('rejects a tampered body', () => {
    const timestamp = String(Date.now());
    const result = verifySignatureV3({
      method: 'POST',
      uri: URI,
      rawBody: `${body} `,
      timestamp,
      signature: sign('POST', URI, body, timestamp),
      clientSecret: SECRET,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'signature_mismatch');
  });

  it('rejects a replayed request outside the window', () => {
    const timestamp = String(Date.now() - 10 * 60 * 1000);
    const result = verifySignatureV3({
      method: 'POST',
      uri: URI,
      rawBody: body,
      timestamp,
      signature: sign('POST', URI, body, timestamp),
      clientSecret: SECRET,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'timestamp_outside_replay_window');
  });

  it('rejects a request signed with the wrong secret', () => {
    const timestamp = String(Date.now());
    const result = verifySignatureV3({
      method: 'POST',
      uri: URI,
      rawBody: body,
      timestamp,
      signature: sign('POST', URI, body, timestamp, 'other-secret'),
      clientSecret: SECRET,
    });
    assert.equal(result.valid, false);
  });
});

describe('LeadQueue', () => {
  it('releases leads in batches within the concurrency budget', async () => {
    const seen = [];
    let peakInFlight = 0;
    let inFlight = 0;

    const queue = new LeadQueue({
      batchSize: 3,
      concurrency: 2,
      handler: async (batch) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(batch.length);
        inFlight -= 1;
      },
    });

    const drained = new Promise((resolve) => queue.once('drain', resolve));
    queue.enqueue(Array.from({ length: 10 }, (_, i) => ({ phone: `+1305555010${i}` })));
    await drained;

    assert.equal(seen.reduce((sum, n) => sum + n, 0), 10);
    assert.ok(peakInFlight <= 2, `expected at most 2 batches in flight, saw ${peakInFlight}`);
  });

  it('de-duplicates repeat webhooks for the same contact', () => {
    const queue = new LeadQueue({ batchSize: 5, concurrency: 1 });
    queue.pause();
    assert.equal(queue.enqueue([{ contactId: '1', phone: '+13055550101' }]), 1);
    assert.equal(queue.enqueue([{ contactId: '1', phone: '+13055550101' }]), 0);
    assert.equal(queue.stats.duplicates, 1);
  });

  it('expires de-dupe entries so a lead can be dialed again later', async () => {
    const queue = new LeadQueue({ batchSize: 5, concurrency: 1, seenTtlMs: 20 });
    queue.pause();

    assert.equal(queue.enqueue([{ contactId: '1', phone: '+13055550101' }]), 1);
    assert.equal(queue.enqueue([{ contactId: '1', phone: '+13055550101' }]), 0);

    await new Promise((resolve) => setTimeout(resolve, 40));

    // Past the TTL the same contact is a legitimate new lead, not a duplicate.
    assert.equal(queue.enqueue([{ contactId: '1', phone: '+13055550101' }]), 1);
    assert.ok(queue.stats.seenEvicted >= 1);
  });

  it('caps the de-dupe map so it cannot grow without bound', () => {
    const queue = new LeadQueue({
      batchSize: 100,
      concurrency: 1,
      maxSeenEntries: 10,
      maxQueueLength: 1000,
    });
    queue.pause();

    for (let i = 0; i < 50; i += 1) {
      queue.enqueue([{ contactId: String(i), phone: `+1305555${String(i).padStart(4, '0')}` }]);
    }

    assert.ok(queue.seen.size <= 10, `expected the map capped at 10, saw ${queue.seen.size}`);
    assert.ok(queue.stats.seenEvicted > 0);
  });
});

describe('normalizePhone', () => {
  it('promotes NANP numbers to E.164', () => {
    assert.equal(normalizePhone('(305) 555-0123'), '+13055550123');
    assert.equal(normalizePhone('13055550123'), '+13055550123');
    assert.equal(normalizePhone('+13055550123'), '+13055550123');
  });

  it('returns an empty string for unusable input', () => {
    assert.equal(normalizePhone(''), '');
    assert.equal(normalizePhone('12345'), '');
  });
});

describe('buildOutcomeLine', () => {
  it('renders the outcome label with no notes', () => {
    assert.equal(buildOutcomeLine({ outcome: 'meeting' }), `Agent outcome: ${AGENT_OUTCOME_LABELS.meeting}`);
  });

  it('appends trimmed notes on their own line', () => {
    assert.equal(
      buildOutcomeLine({ outcome: 'callback', notes: '  call back Thursday  ' }),
      `Agent outcome: ${AGENT_OUTCOME_LABELS.callback}\ncall back Thursday`,
    );
  });

  it('omits the notes line entirely when notes are blank', () => {
    assert.equal(
      buildOutcomeLine({ outcome: 'not_interested', notes: '   ' }),
      `Agent outcome: ${AGENT_OUTCOME_LABELS.not_interested}`,
    );
  });

  it('is deterministic for the same input, which is what the retry idempotency check relies on', () => {
    const a = buildOutcomeLine({ outcome: 'meeting', notes: 'x' });
    const b = buildOutcomeLine({ outcome: 'meeting', notes: 'x' });
    assert.equal(a, b);
  });
});

describe('appendCallOutcome', () => {
  // No HUBSPOT_ACCESS_TOKEN in the test environment, so only the input-shape
  // guards are reachable without a live client — checked first for exactly
  // this reason (see the function's own comment).

  it('rejects a missing callSid without needing HubSpot configured', async () => {
    const result = await appendCallOutcome({ callSid: '', outcome: 'meeting' });
    assert.deepEqual(result, { ok: false, reason: 'callSid_required' });
  });

  it('rejects an outcome that is not one of the known keys', async () => {
    const result = await appendCallOutcome({ callSid: 'CA123', outcome: 'not_a_real_outcome' });
    assert.deepEqual(result, { ok: false, reason: 'invalid_outcome' });
  });

  it('reports hubspot_not_configured only once the shape is valid', async () => {
    const result = await appendCallOutcome({ callSid: 'CA123', outcome: 'meeting' });
    assert.deepEqual(result, { ok: false, reason: 'hubspot_not_configured' });
  });
});
