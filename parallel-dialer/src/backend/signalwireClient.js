/**
 * SignalWire Compatibility API client — drop-in replacement for twilioClient.js.
 *
 * Uses SignalWire's LaML Compatibility API which mirrors the Twilio REST API
 * at `https://{space}.signalwire.com/api/laml/2010-04-01/...`. The request
 * shape, response shape, TwiML/LaML documents, and webhook signatures are
 * identical, so the rest of the codebase (dialerEngine, streamHandler, TwiML
 * routes) works without changes.
 *
 * Browser WebRTC tokens are minted via SignalWire's relay REST endpoint and
 * returned in the same `{ token, identity, expiresInSeconds }` shape the
 * frontend expects — but the browser SDK (`@signalwire/js`) has a different
 * Device/Client object model, so the frontend adapter is a separate piece.
 */
import twilio from 'twilio';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'signalwireClient' });

/** @type {import('twilio').Twilio | null} */
let client = null;

/**
 * Lazily construct a REST client pointed at SignalWire's Compatibility API.
 *
 * The `twilio` npm package works here because SignalWire deliberately mirrors
 * the Twilio REST interface. We override `accountSid` and the API base URI.
 */
export function getSignalWireClient() {
  if (client) return client;
  const { projectId, apiToken, spaceUrl } = config.signalwire;
  if (!projectId || !apiToken || !spaceUrl) {
    throw new Error('SignalWire credentials are not configured (SIGNALWIRE_PROJECT_ID / SIGNALWIRE_API_TOKEN / SIGNALWIRE_SPACE_URL)');
  }

  const space = spaceUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  client = twilio(projectId, apiToken, {
    accountSid: projectId,
    autoRetry: true,
    maxRetries: 2,
  });

  // Point every REST call at the SignalWire Compatibility API.
  client.api._baseUri = `https://${space}/api/laml/2010-04-01`;
  client.api._uri = `https://${space}/api/laml/2010-04-01/Accounts/${projectId}`;

  log.info('signalwire compatibility client initialised', { space });
  return client;
}

const TERMINAL_CALL_ERRORS = new Set([20404, 21220]);

export async function hangupCall(callSid, opts = {}) {
  const rest = getSignalWireClient();
  try {
    await rest.calls(callSid).update({ status: 'completed' });
    log.debug('call terminated', { callSid, reason: opts.reason ?? 'unspecified' });
    return true;
  } catch (err) {
    if (TERMINAL_CALL_ERRORS.has(err?.code)) {
      log.debug('call already terminal', { callSid, code: err.code });
      return true;
    }
    try {
      await rest.calls(callSid).update({ status: 'canceled' });
      log.debug('call canceled', { callSid, reason: opts.reason ?? 'unspecified' });
      return true;
    } catch (cancelErr) {
      if (TERMINAL_CALL_ERRORS.has(cancelErr?.code)) return true;
      log.warn('failed to terminate call', { callSid, err: cancelErr });
      return false;
    }
  }
}

export async function redirectCall(callSid, twiml) {
  const rest = getSignalWireClient();
  return rest.calls(callSid).update({ twiml });
}

/**
 * Mint a browser access token via SignalWire's relay REST JWT endpoint.
 *
 * NOTE: the returned token works with `@signalwire/js`, NOT with
 * `@twilio/voice-sdk`. The frontend needs a separate SignalWire Device
 * adapter to consume this token.
 */
export async function createVoiceAccessToken(identity) {
  const { projectId, apiToken, spaceUrl, tokenTtlSeconds } = config.signalwire;
  if (!projectId || !apiToken || !spaceUrl) {
    throw new Error('Cannot mint a voice token: SignalWire credentials are not configured');
  }

  const space = spaceUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const url = `https://${space}/api/relay/rest/jwt`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString('base64')}`,
    },
    body: JSON.stringify({
      expires_in: tokenTtlSeconds,
      resource: identity,
      scopes: ['calling'],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SignalWire JWT request failed: ${response.status} ${body}`);
  }

  const data = await response.json();

  return {
    token: data.jwt_token,
    identity,
    expiresInSeconds: tokenTtlSeconds,
    provider: 'signalwire',
  };
}

/**
 * Webhook signature validation for SignalWire.
 *
 * SignalWire's Compatibility API uses the same HMAC-SHA1 signature scheme as
 * Twilio, so `twilio.validateRequest` works with the SignalWire API token.
 */
export function signalwireWebhookAuth() {
  return (req, res, next) => {
    if (!config.signalwire.validateSignature) return next();

    const signature = req.get('X-Twilio-Signature') ?? req.get('X-SignalWire-Signature');
    const url = `${config.publicBaseUrl}${req.originalUrl}`;
    const valid = twilio.validateRequest(config.signalwire.apiToken, signature ?? '', url, req.body ?? {});

    if (!valid) {
      log.warn('rejected unsigned SignalWire webhook', { path: req.originalUrl });
      return res.status(403).type('text/plain').send('Invalid webhook signature');
    }
    return next();
  };
}

export default { getSignalWireClient, hangupCall, redirectCall, createVoiceAccessToken, signalwireWebhookAuth };
