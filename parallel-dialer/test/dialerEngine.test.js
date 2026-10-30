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

  it('carries the session agent identity on every leg', async () => {
    // CRM logging reads this; a global default would misattribute calls once a
    // second agent is dialing.
    const session = await harness.engine.startSession({
      agentIdentity: 'agent_7',
      leads: LEADS,
      batchSize: 3,
      autoAdvance: false,
    });

    for (const leg of session.currentBatch.legs) {
      assert.equal(leg.agentIdentity, 'agent_7');
    }
    assert.equal(harness.engine.getLeg(session.currentBatch.legs[0].legId).agentIdentity, 'agent_7');
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

describe('power-dial mode (screening: false)', () => {
  let harness;
  beforeEach(() => {
    harness = makeHarness();
  });

  /** Start a one-line power-dial session and return its only leg snapshot. */
  async function startPowerDial(overrides = {}) {
    const session = await harness.engine.startSession({
      leads: [LEADS[0]], batchSize: 1, autoAdvance: false, screening: false, ...overrides,
    });
    return session.currentBatch.legs[0];
  }

  it('bridges the agent on answer, without waiting for a verdict', async () => {
    const leg = await startPowerDial();
    assert.equal(harness.redirected.length, 0, 'nothing bridged before the answer');

    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'in-progress' });

    assert.equal(harness.redirected.length, 1);
    assert.match(harness.redirected[0].twiml, /<Client>agent_1<\/Client>/);
    const after = harness.engine.getLeg(leg.legId);
    assert.equal(after.state, LegState.CONNECTED);
    assert.equal(after.disposition, Disposition.HUMAN);
  });

  it('does not bridge twice when Twilio re-delivers the answer callback', async () => {
    const leg = await startPowerDial();

    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'in-progress' });
    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'in-progress' });

    assert.equal(harness.redirected.length, 1, 're-delivered callback must not re-bridge');
  });

  it('records a MACHINE verdict but never hangs up on it', async () => {
    const leg = await startPowerDial();
    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'in-progress' });

    const events = [];
    harness.engine.on('leg:classified', (e) => events.push(e));

    await harness.engine.classify({ legId: leg.legId }, 'MACHINE', { latencyMs: 900, reason: 'test' });

    assert.equal(events.length, 1);
    assert.equal(events[0].classification, 'MACHINE');
    assert.equal(events[0].acted, false, 'verdict is recorded, not acted on');
    assert.equal(harness.hungUp.length, 0, 'a wrong verdict must not drop a live call');

    const after = harness.engine.getLeg(leg.legId);
    assert.equal(after.state, LegState.CONNECTED, 'still bridged to the agent');
    assert.equal(after.disposition, Disposition.HUMAN);
    assert.equal(after.classificationLatencyMs, 900, 'latency still recorded for scoring');
  });

  it('still screens when screening is left at its default', async () => {
    const session = await harness.engine.startSession({
      leads: [LEADS[0]], batchSize: 1, autoAdvance: false,
    });
    const leg = session.currentBatch.legs[0];

    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'in-progress' });
    assert.equal(harness.redirected.length, 0, 'screened mode waits for a verdict');

    await harness.engine.classify({ legId: leg.legId }, 'MACHINE', { reason: 'test' });
    assert.equal(harness.hungUp.length, 1, 'screened mode still drops a machine');
  });
});

describe('power-dial mode interlock', () => {
  it('forces batchSize 1 so no leg can be abandoned without an announcement', async () => {
    const harness = makeHarness();
    const session = await harness.engine.startSession({
      leads: LEADS, batchSize: 5, autoAdvance: false, screening: false,
    });

    // With screening off the abandoned-call path in classify() never runs, so
    // a losing leg would be hung up on silently. One line makes that
    // impossible rather than relying on a later guard.
    assert.equal(session.batchSize, 1);
    assert.equal(session.currentBatch.legs.length, 1);
  });
});

describe('pause / resume and hold-after-human', () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  /** One-line power-dial session over two leads that advances on its own. */
  async function startTwoLeadSession(harness, overrides = {}) {
    const started = [];
    harness.engine.on('batch:started', (batch) => started.push(batch));
    const session = await harness.engine.startSession({
      leads: [LEADS[0], LEADS[1]], batchSize: 1, screening: false, ...overrides,
    });
    return { session, leg: session.currentBatch.legs[0], started };
  }

  /** Answer the leg, then hang it up, the way a finished conversation looks. */
  async function finishConversation(engine, leg) {
    await engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'in-progress' });
    await engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'completed' });
    await tick();
    await tick();
  }

  it('does not dial the next batch while paused, and dials it on resume', async () => {
    const harness = makeHarness();
    const { session, leg, started } = await startTwoLeadSession(harness);

    harness.engine.pauseSession(session.sessionId);
    await finishConversation(harness.engine, leg);

    assert.equal(started.length, 1, 'no second batch while paused');
    assert.equal(harness.engine.snapshotSession(session.sessionId).remainingLeads, 1);

    await harness.engine.resumeSession(session.sessionId);
    assert.equal(started.length, 2, 'resume dials the held-back batch');
    assert.equal(harness.engine.snapshotSession(session.sessionId).paused, false);
  });

  it('pauses itself after a human conversation when holdAfterHuman is set', async () => {
    const harness = makeHarness();
    const { session, leg, started } = await startTwoLeadSession(harness, { holdAfterHuman: true });
    const paused = [];
    harness.engine.on('session:paused', (event) => paused.push(event));

    await finishConversation(harness.engine, leg);

    assert.equal(paused.length, 1);
    assert.equal(paused[0].reason, 'after_human');
    assert.equal(started.length, 1, 'held for notes, next lead not dialed');

    await harness.engine.resumeSession(session.sessionId);
    assert.equal(started.length, 2);
  });

  it('keeps dialing straight through calls that never reached a human', async () => {
    const harness = makeHarness();
    const { leg, started } = await startTwoLeadSession(harness, { holdAfterHuman: true });

    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'no-answer' });
    await tick();
    await tick();

    assert.equal(started.length, 2, 'no-answer advances without a hold');
  });

  it('does not dial after the delay if the session was stopped meanwhile', async () => {
    const harness = makeHarness();
    const { session, leg, started } = await startTwoLeadSession(harness, { advanceDelayMs: 30 });

    await harness.engine.handleStatusCallback({ legId: leg.legId, CallStatus: 'no-answer' });
    await harness.engine.stopSession(session.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(started.length, 1);
  });
});
