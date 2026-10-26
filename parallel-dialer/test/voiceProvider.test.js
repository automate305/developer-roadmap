import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('voiceProvider', () => {
  it('exports all required functions', async () => {
    const mod = await import('../src/backend/voiceProvider.js');
    assert.equal(typeof mod.getVoiceClient, 'function');
    assert.equal(typeof mod.hangupCall, 'function');
    assert.equal(typeof mod.redirectCall, 'function');
    assert.equal(typeof mod.createVoiceAccessToken, 'function');
    assert.equal(typeof mod.webhookAuth, 'function');
    assert.equal(typeof mod.getCallerId, 'function');
    assert.equal(typeof mod.getAuthSecret, 'function');
  });

  it('defaults to twilio provider', async () => {
    const { config } = await import('../src/config/env.js');
    assert.equal(config.voiceProvider, 'twilio');
  });

  it('getCallerId returns twilio caller ID by default', async () => {
    const { getCallerId } = await import('../src/backend/voiceProvider.js');
    const { config } = await import('../src/config/env.js');
    assert.equal(getCallerId(), config.twilio.callerId);
  });
});

describe('signalwireClient', () => {
  it('exports the expected interface', async () => {
    const mod = await import('../src/backend/signalwireClient.js');
    assert.equal(typeof mod.getSignalWireClient, 'function');
    assert.equal(typeof mod.hangupCall, 'function');
    assert.equal(typeof mod.redirectCall, 'function');
    assert.equal(typeof mod.createVoiceAccessToken, 'function');
    assert.equal(typeof mod.signalwireWebhookAuth, 'function');
  });

  it('throws when credentials are missing', async () => {
    const { getSignalWireClient } = await import('../src/backend/signalwireClient.js');
    assert.throws(() => getSignalWireClient(), /SignalWire credentials are not configured/);
  });
});
