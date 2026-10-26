/**
 * telephonyClient.js with TELEPHONY_PROVIDER=signalwire.
 *
 * `env.js`/`telephonyClient.js` compute their exports once, at module
 * evaluation. A *static* `import` is hoisted and evaluated before any other
 * top-level code in this file runs — including a `process.env.X = ...` line
 * placed textually above it — so the only way to get these modules to see a
 * different `TELEPHONY_PROVIDER` than whatever process-wide default they'd
 * otherwise pick up is a *dynamic* `import()` after setting the env var,
 * which is not hoisted. (This file still runs in its own process — Node's
 * default per-file test isolation — so mutating `process.env` here cannot
 * leak into other test files either way.)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.TELEPHONY_PROVIDER = 'signalwire';
process.env.SIGNALWIRE_SPACE_URL = 'example.signalwire.com';

const { provider, VoiceResponse, buildAgentDialNoun } = await import('../src/backend/telephonyClient.js');

describe('telephonyClient (signalwire provider)', () => {
  it('picks signalwire when TELEPHONY_PROVIDER=signalwire', () => {
    assert.equal(provider, 'signalwire');
  });

  it('exposes a cXML-compatible VoiceResponse builder (RestClient.LaML)', () => {
    const vr = new VoiceResponse();
    vr.say('hi');
    assert.match(vr.toString(), /<Say>hi<\/Say>/);

    const connect = vr.connect();
    const stream = connect.stream({ url: 'wss://example.signalwire.com/media-stream' });
    stream.parameter({ name: 'legId', value: 'leg_1' });
    assert.match(vr.toString(), /<Connect><Stream url="wss:\/\/example\.signalwire\.com\/media-stream">/);
    assert.match(vr.toString(), /<Parameter name="legId" value="leg_1"\/>/);
  });

  it('bridges the agent with a <Sip> noun pointed at the SIP endpoint domain, not <Client>', () => {
    assert.equal(buildAgentDialNoun('agent_1'), '<Sip>sip:agent_1@example.signalwire.com</Sip>');
  });

  it('escapes XML-unsafe characters in the identity', () => {
    assert.equal(buildAgentDialNoun('agent&1'), '<Sip>sip:agent&amp;1@example.signalwire.com</Sip>');
  });
});
