/**
 * Batch race tests. The invariant under test: exactly one leg per batch can be
 * bridged to the agent, and every other leg is torn down.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { DialerEngine, Disposition, LegState, normalizeLead } from '../src/backend/dialerEngine.js';

/** Twilio REST double: hands out predictable SIDs and records teardowns. */
function makeHarness() {
  let counter = 0;
  const hungUp = [];
  const redirected = [];

  const engine = new DialerEngine({
    getClient: () => ({
      calls: {
        create: async () => ({ sid: `CA${String(++counter).padStart(4, '0')}` }),
      },
    }),
    hangupCall: async (sid, opts) => {
      hungUp.push({ sid, reason: opts?.reason });
      return true;
    },
    redirectCall: async (sid, twiml) => {
      redirected.push({ sid, twiml });
      return {};
    },
  });

  return { engine, hungUp, redirected };
}

const LEADS = ['+13055550101', '+13055550102', '+13055550103'];

describe('normalizeLead', () => {
  it('accepts bare E.164 strings and objects', () => {
    assert.equal(normalizeLead('+13055550101').phone, '+13055550101');
    assert.equal(normalizeLead({ phone: '+13055550101', contactId: '42' }).contactId, '42');
  });

  it('rejects anything that is not E.164', () => {
    assert.throws(() => normalizeLead('305-555-0101'));
    assert.throws(() => normalizeLead({ phone: '' }));
  });
});

describe('DialerEngine batch race', () => {
  let harness;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('dials every lead in the batch in parallel', async () => {
    const session = await harness.engine.startSession({ leads: LEADS, batchSize: 3, autoAdvance: false });
    assert.equal(session.currentBatch.legs.length, 3);
    for (const leg of session.currentBatch.legs) {
      assert.equal(leg.state, LegState.RINGING);
      assert.ok(leg.callSid);
    }
  });

  it('bridges the first human and tears down the rest', async () => {
    const session = await harness.engine.startSession({ leads: LEADS, batchSize: 3, autoAdvance: false });
    const [first, ...losers] = session.currentBatch.legs;

    await harness.engine.classify({ legId: first.legId }, 'HUMAN', { transcript: 'hello' });

    const winner = harness.engine.getLeg(first.legId);
    assert.equal(winner.state, LegState.CONNECTED);
    assert.equal(winner.disposition, Disposition.HUMAN);
    assert.equal(harness.redirected.length, 1);
    assert.match(harness.redirected[0].twiml, /<Client>agent_1<\/Client>/);

    assert.equal(harness.hungUp.length, losers.length);
    for (const loser of losers) {
      assert.equal(harness.engine.getLeg(loser.legId).state, LegState.ENDED);
    }
  });

  it('marks a second human on the same batch as abandoned, not connected', async () => {
    const session = await harness.engine.startSession({ leads: LEADS, batchSize: 3, autoAdvance: false });
    const [first, second] = session.currentBatch.legs;

    await harness.engine.classify({ legId: first.legId }, 'HUMAN', {});
    await harness.engine.classify({ legId: second.legId }, 'HUMAN', {});

    assert.equal(harness.engine.getLeg(first.legId).disposition, Disposition.HUMAN);
    assert.equal(harness.engine.getLeg(second.legId).disposition, Disposition.ABANDONED);
    // The abandoned leg hears the identification message rather than silence.
    assert.equal(harness.redirected.length, 2);
    assert.match(harness.redirected[1].twiml, /Sorry for the interruption/);
  });

  it('ignores a repeat classification for the same leg', async () => {
    const session = await harness.engine.startSession({ leads: LEADS, batchSize: 3, autoAdvance: false });
    const [first] = session.currentBatch.legs;

    await harness.engine.classify({ legId: first.legId }, 'MACHINE', {});
    await harness.engine.classify({ legId: first.legId }, 'HUMAN', {});

    assert.equal(harness.engine.getLeg(first.legId).disposition, Disposition.MACHINE);
    assert.equal(harness.redirected.length, 0);
  });

  it('hangs up machines and no-answers without bridging', async () => {
    const session = await harness.engine.startSession({ leads: LEADS, batchSize: 3, autoAdvance: false });
    const [a, b] = session.currentBatch.legs;

    await harness.engine.classify({ legId: a.legId }, 'MACHINE', {});
    await harness.engine.classify({ legId: b.legId }, 'NO_ANSWER', {});

    assert.equal(harness.engine.getLeg(a.legId).disposition, Disposition.MACHINE);
    assert.equal(harness.engine.getLeg(b.legId).disposition, Disposition.NO_ANSWER);
    assert.equal(harness.redirected.length, 0);
    assert.equal(harness.hungUp.length, 2);
  });
});
