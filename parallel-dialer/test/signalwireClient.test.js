/**
 * signalwireClient.js — the SignalWire-specific half of telephonyClient.js.
 *
 * Covers the SIP-credential handoff (`createVoiceAccessToken` — classic SIP
 * Endpoint credentials, not a Call Fabric SAT; see that function's own doc
 * comment for why) and webhook signature validation. `hangupCall`/
 * `redirectCall` have no injection seam of their own — see the note below
 * `getSignalwireClient`'s test.
 *
 * Env vars are set before a *dynamic* `import()`, not a static one — see
 * telephonyClient.signalwire.test.js's top comment for why a static import
 * would still see config/env.js's defaults regardless of source order.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

process.env.TELEPHONY_PROVIDER = 'signalwire';
process.env.SIGNALWIRE_PROJECT_ID = 'proj_test';
process.env.SIGNALWIRE_API_TOKEN = 'tok_test';
process.env.SIGNALWIRE_SPACE_URL = 'example.signalwire.com';
process.env.SIGNALWIRE_SIP_ENDPOINT_USERNAME = 'agent_1';
process.env.SIGNALWIRE_SIP_ENDPOINT_PASSWORD = 'sip_secret';
process.env.PUBLIC_BASE_URL = 'https://dialer.example.com';

const { getSignalwireClient, createVoiceAccessToken, signalwireWebhookAuth } = await import(
  '../src/backend/signalwireClient.js'
);

describe('getSignalwireClient', () => {
  it('builds a REST client pointed at the configured space', () => {
    const client = getSignalwireClient();
    assert.equal(client.api.baseUrl, 'https://example.signalwire.com');
  });
});

// `hangupCall`/`redirectCall` themselves have no injection seam (same as
// twilioClient.js, which dialerEngine.test.js exercises through DialerEngine's
// own `hangupCall`/`redirectCall` constructor deps instead of calling
// twilioClient.js directly) — a live-network REST call can't be driven from
// here without a double for the vendored twilio-node client underneath
// RestClient. That exercise already happens at the DialerEngine level via its
// injectable `hangupCall`/`redirectCall`/`getClient` deps (dialerEngine.test.js),
// which is provider-agnostic by construction. Not re-tested here.

describe('createVoiceAccessToken', () => {
  it('hands out the configured SIP Endpoint credentials, not a Call Fabric token', async () => {
    const result = await createVoiceAccessToken('agent_1');
    assert.equal(result.token, 'sip_secret');
    assert.equal(result.identity, 'agent_1');
    assert.equal(result.expiresInSeconds, 3600);
    assert.equal(result.sipDomain, 'example.signalwire.com');
    assert.equal(result.wsServer, 'wss://example.signalwire.com');
  });

  // The "SIP Endpoint not configured" / "identity mismatch" branches need a
  // different `config.signalwire` than this file's own (config.js freezes
  // its snapshot at the dynamic import above) — see
  // config.signalwire.test.js, which pins the missing-SIP-Endpoint-config
  // warning from validateConfig() in a state built for exactly that.
});

describe('signalwireWebhookAuth', () => {
  function sign(apiToken, url, params) {
    const data = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], url);
    return crypto.createHmac('sha1', apiToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  }

  function runMiddleware({ headers = {}, body = {}, originalUrl = '/twiml/outbound' }) {
    const middleware = signalwireWebhookAuth();
    let statusCode = null;
    let sent = null;
    let nextCalled = false;
    const req = { get: (name) => headers[name.toLowerCase()] ?? headers[name], body, originalUrl };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      type() {
        return this;
      },
      send(payload) {
        sent = payload;
      },
    };
    middleware(req, res, () => {
      nextCalled = true;
    });
    return { nextCalled, statusCode, sent };
  }

  it('accepts a correctly signed request', () => {
    const body = { CallSid: 'CA123', CallStatus: 'ringing' };
    const url = 'https://dialer.example.com/twiml/outbound';
    const signature = sign('tok_test', url, body);
    const { nextCalled } = runMiddleware({
      headers: { 'x-signalwire-signature': signature },
      body,
    });
    assert.equal(nextCalled, true);
  });

  it('rejects a missing signature', () => {
    const { nextCalled, statusCode } = runMiddleware({ body: { CallSid: 'CA123' } });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it('rejects a tampered body', () => {
    const body = { CallSid: 'CA123', CallStatus: 'ringing' };
    const url = 'https://dialer.example.com/twiml/outbound';
    const signature = sign('tok_test', url, body);
    const { nextCalled, statusCode } = runMiddleware({
      headers: { 'x-signalwire-signature': signature },
      body: { ...body, CallStatus: 'completed' },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });
});
