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
