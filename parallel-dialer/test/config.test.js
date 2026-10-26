/**
 * Public-URL derivation.
 *
 * This value is both the base for Twilio's TwiML callbacks and the origin of
 * the `wss://` Media Stream URL, and it is what Twilio validates its request
 * signature against. A wrong value fails quietly, so the precedence rules are
 * pinned here.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { derivePublicBaseUrl } from '../src/config/env.js';

const SAVED = { ...process.env };
afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
  Object.assign(process.env, SAVED);
});

describe('derivePublicBaseUrl', () => {
  it('derives an https origin from the platform domain', () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'dialer.up.railway.app';
    assert.equal(derivePublicBaseUrl(), 'https://dialer.up.railway.app');
  });

  it('lets an explicit custom domain win over the platform one', () => {
    process.env.PUBLIC_BASE_URL = 'https://dialer.automate305.com';
    process.env.RAILWAY_PUBLIC_DOMAIN = 'dialer.up.railway.app';
    assert.equal(derivePublicBaseUrl(), 'https://dialer.automate305.com');
  });

  it('falls back to localhost for development', () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    assert.equal(derivePublicBaseUrl(), 'http://localhost:3000');
  });

  it('strips a trailing slash so callback URLs do not double up', () => {
    process.env.PUBLIC_BASE_URL = 'https://dialer.automate305.com/';
    assert.equal(derivePublicBaseUrl(), 'https://dialer.automate305.com');
  });

  it('tolerates a platform domain that already carries a scheme', () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'https://dialer.up.railway.app/';
    assert.equal(derivePublicBaseUrl(), 'https://dialer.up.railway.app');
  });
});

describe('validateConfig — provider-dependent requirements', () => {
  // `config` is a frozen snapshot taken at module load, computed from
  // `process.env` at import time — these assertions run against whatever
  // TELEPHONY_PROVIDER this process happened to start with (unset in this
  // file ⇒ 'twilio'; see telephonyClient.signalwire.test.js for the
  // SignalWire branch of the *telephony client* dispatch, which has the same
  // load-order constraint). Here we only check that validateConfig() itself
  // asks for the right env vars given whichever provider is active.
  it('requires the Twilio trio when no provider override is in effect', async () => {
    const { validateConfig, config } = await import('../src/config/env.js');
    if (config.telephony.provider !== 'twilio') return; // guarded, see note above
    const { missing } = validateConfig();
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_CALLER_ID']) {
      if (!process.env[key]) assert.ok(missing.includes(key), `expected ${key} in missing`);
    }
    assert.ok(!missing.some((k) => k.startsWith('SIGNALWIRE_')));
  });
});
