/**
 * telephonyClient.js with TELEPHONY_PROVIDER=twilio. The dispatch happens once
 * at module load, so each provider is pinned in its own file/process: this
 * one for Twilio, test/telephonyClient.signalwire.test.js for SignalWire.
 * The unset-env default (SignalWire) is asserted in config.test.js.
 *
 * Dynamic `import()` after setting `process.env`, not a static import —
 * static imports are hoisted and would read the env before this line runs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.TELEPHONY_PROVIDER = 'twilio';
const { provider, VoiceResponse, callerId, buildAgentDialNoun } = await import('../src/backend/telephonyClient.js');
const { validateConfig } = await import('../src/config/env.js');

describe('telephonyClient (twilio provider)', () => {
  it('selects twilio when TELEPHONY_PROVIDER=twilio', () => {
    assert.equal(provider, 'twilio');
  });

  it('requires the Twilio trio, not the SignalWire block', () => {
    const { missing } = validateConfig();
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_CALLER_ID']) {
      if (!process.env[key]) assert.ok(missing.includes(key), `expected ${key} in missing`);
    }
    assert.ok(!missing.some((k) => k.startsWith('SIGNALWIRE_')));
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
