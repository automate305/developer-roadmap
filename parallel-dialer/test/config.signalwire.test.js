/**
 * validateConfig() with TELEPHONY_PROVIDER=signalwire.
 *
 * Dynamic `import()` after setting `process.env`, not a static import —
 * see telephonyClient.signalwire.test.js's top comment for why a static
 * import here would still see the default (Twilio) provider regardless of
 * where the `process.env.X = ...` lines sit in the file.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.TELEPHONY_PROVIDER = 'signalwire';
delete process.env.SIGNALWIRE_PROJECT_ID;
delete process.env.SIGNALWIRE_API_TOKEN;
delete process.env.SIGNALWIRE_SPACE_URL;
delete process.env.SIGNALWIRE_CALLER_ID;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_CALLER_ID;

const { validateConfig } = await import('../src/config/env.js');

describe('validateConfig (signalwire provider)', () => {
  it('requires the SignalWire quartet instead of Twilio credentials, and warns about the SIP endpoint', () => {
    const { ok, missing, warnings } = validateConfig();
    assert.equal(ok, false);
    assert.deepEqual(
      [...missing].sort(),
      ['SIGNALWIRE_API_TOKEN', 'SIGNALWIRE_CALLER_ID', 'SIGNALWIRE_PROJECT_ID', 'SIGNALWIRE_SPACE_URL'].sort(),
    );
    assert.ok(!missing.some((k) => k.startsWith('TWILIO_')));
    // SIGNALWIRE_SIP_ENDPOINT_USERNAME/PASSWORD are unset too — the warning
    // that exists purely for the SignalWire bridging gap should fire.
    assert.ok(warnings.some((w) => w.includes('SIP_ENDPOINT')));
  });
});
