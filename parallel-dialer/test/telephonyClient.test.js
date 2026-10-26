/**
 * telephonyClient.js with the default provider (Twilio, since
 * TELEPHONY_PROVIDER is unset). The dispatch happens once at module load, so
 * the SignalWire branch is pinned in its own file/process instead —
 * test/telephonyClient.signalwire.test.js — which sets `TELEPHONY_PROVIDER`
 * before importing anything.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { provider, VoiceResponse, callerId, buildAgentDialNoun } from '../src/backend/telephonyClient.js';

describe('telephonyClient (default provider)', () => {
  it('defaults to twilio when TELEPHONY_PROVIDER is unset', () => {
    assert.equal(provider, 'twilio');
  });

  it('exposes the Twilio TwiML VoiceResponse constructor', () => {
    const vr = new VoiceResponse();
    vr.say('hi');
    assert.match(vr.toString(), /<Say>hi<\/Say>/);
  });

  it('reads the caller id from the twilio config block', () => {
    // Unset in this test environment — asserting the wiring, not a value.
    assert.equal(callerId, process.env.TWILIO_CALLER_ID ?? undefined);
  });

  it('bridges the agent with a <Client> noun on Twilio', () => {
    assert.equal(buildAgentDialNoun('agent_1'), '<Client>agent_1</Client>');
  });

  it('escapes XML-unsafe characters in the identity', () => {
    assert.equal(buildAgentDialNoun('agent&1'), '<Client>agent&amp;1</Client>');
  });
});
