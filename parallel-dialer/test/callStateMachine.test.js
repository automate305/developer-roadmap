/**
 * Unit tests for the agent workstation's call/device transition table. Pure
 * logic, no DOM and no Twilio SDK — just the state graph.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentStatus, transition } from '../src/frontend/lib/callStateMachine.js';

describe('callStateMachine', () => {
  it('walks the happy path: offline to a bridged call and back', () => {
    let state = AgentStatus.OFFLINE;
    state = transition(state, 'CONNECT');
    assert.equal(state, AgentStatus.CONNECTING);
    state = transition(state, 'REGISTERED');
    assert.equal(state, AgentStatus.READY);
    state = transition(state, 'INCOMING');
    assert.equal(state, AgentStatus.RINGING);
    state = transition(state, 'ACCEPTED');
    assert.equal(state, AgentStatus.IN_CALL);
    state = transition(state, 'CALL_ENDED');
    assert.equal(state, AgentStatus.READY);
  });

  it('accepts a call directly from READY (auto-answer skips RINGING)', () => {
    assert.equal(transition(AgentStatus.READY, 'ACCEPTED'), AgentStatus.IN_CALL);
  });

  it('rejects illegal transitions instead of guessing a next state', () => {
    assert.equal(transition(AgentStatus.OFFLINE, 'ACCEPTED'), null);
    assert.equal(transition(AgentStatus.OFFLINE, 'INCOMING'), null);
    assert.equal(transition(AgentStatus.IN_CALL, 'CONNECT'), null);
    assert.equal(transition(AgentStatus.READY, 'REGISTERED'), null);
  });

  it('reaches DEVICE_ERROR and UNREGISTERED from any state', () => {
    for (const state of Object.values(AgentStatus)) {
      assert.equal(transition(state, 'DEVICE_ERROR'), AgentStatus.ERROR);
      assert.equal(transition(state, 'UNREGISTERED'), AgentStatus.OFFLINE);
      assert.equal(transition(state, 'GO_OFFLINE'), AgentStatus.OFFLINE);
    }
  });

  it('a call ending while the device is in ERROR does not clear the error', () => {
    assert.equal(transition(AgentStatus.ERROR, 'CALL_ENDED'), AgentStatus.ERROR);
  });

  it('a call ending from RINGING (canceled/rejected before answer) returns to READY', () => {
    assert.equal(transition(AgentStatus.RINGING, 'CALL_ENDED'), AgentStatus.READY);
  });

  it('throws on an event not in the table, rather than silently ignoring it', () => {
    assert.throws(() => transition(AgentStatus.READY, 'NOT_A_REAL_EVENT'), /Unknown call-status event/);
  });
});
