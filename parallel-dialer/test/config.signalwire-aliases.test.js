/**
 * SignalWire config as the credentials were actually handed over: the space
 * under SIGNALWIRE_SPACE (not _URL), no Signing Key, and phone-bridge mode.
 * Own file/process because config/env.js freezes its snapshot at import.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.TELEPHONY_PROVIDER = 'signalwire';
process.env.SIGNALWIRE_PROJECT_ID = 'proj_test';
process.env.SIGNALWIRE_API_TOKEN = 'tok_test';
delete process.env.SIGNALWIRE_SPACE_URL;
process.env.SIGNALWIRE_SPACE = 'https://example.signalwire.com/';
process.env.SIGNALWIRE_CALLER_ID = '+13055550123';
delete process.env.SIGNALWIRE_SIGNING_KEY;
delete process.env.SIGNALWIRE_SIP_DOMAIN;
delete process.env.SIGNALWIRE_SIP_ENDPOINT_USERNAME;
delete process.env.SIGNALWIRE_SIP_ENDPOINT_PASSWORD;
process.env.AGENT_PHONE_NUMBER = '+13055550199';

const { config, validateConfig, deriveSipDomain } = await import('../src/config/env.js');

describe('SignalWire config aliases (gate 1 prep)', () => {
  it('accepts SIGNALWIRE_SPACE and strips a scheme and trailing slash', () => {
    assert.equal(config.signalwire.spaceUrl, 'example.signalwire.com');
    assert.equal(validateConfig().missing.length, 0);
  });

  it('derives the SIP subdomain from the space host', () => {
    assert.equal(config.signalwire.sipDomain, 'example.sip.signalwire.com');
    assert.equal(deriveSipDomain('example.sip.signalwire.com'), 'example.sip.signalwire.com');
    assert.equal(deriveSipDomain(undefined), undefined);
  });

  it('warns when signatures fall back to the API token', () => {
    assert.ok(validateConfig().warnings.some((w) => w.includes('SIGNALWIRE_SIGNING_KEY')));
  });

  it('does not demand a SIP Endpoint in phone-bridge mode', () => {
    assert.ok(!validateConfig().warnings.some((w) => w.includes('SIP_ENDPOINT')));
  });
});
