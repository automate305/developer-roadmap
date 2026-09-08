/**
 * Shared Twilio REST client plus the small helpers the dialer needs on the
 * latency-critical path (hangups, live TwiML redirects, WebRTC tokens).
 */
import twilio from 'twilio';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'twilioClient' });

/** @type {import('twilio').Twilio | null} */
let client = null;

/**
 * Lazily construct the REST client so the process still boots (and serves
 * /health) when Twilio credentials are absent in a test environment.
 */
export function getTwilioClient() {
  if (client) return client;
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    throw new Error('Twilio credentials are not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  }
  client = twilio(config.twilio.accountSid, config.twilio.authToken, {
    // Batches fire N calls at once; a shared agent keeps sockets warm.
    autoRetry: true,
    maxRetries: 2,
  });
  return client;
}

/** Twilio error codes that mean "the call already ended" — safe to ignore. */
const TERMINAL_CALL_ERRORS = new Set([
  20404, // resource not found (call already reaped)
  21220, // invalid call state transition
]);

/**
 * Hang up a call, tolerating the race where the far end disconnects first.
 *
 * Twilio only accepts `canceled` for calls still queued or ringing, and only
 * `completed` for calls already in progress. We try `completed` first (the
 * common case in a dialing batch) and fall back to `canceled`.
 *
 * @param {string} callSid
 * @param {{ reason?: string }} [opts]
 * @returns {Promise<boolean>} true when the call was (or already was) torn down
 */
export async function hangupCall(callSid, opts = {}) {
  const rest = getTwilioClient();
  try {
    await rest.calls(callSid).update({ status: 'completed' });
    log.debug('call terminated', { callSid, reason: opts.reason ?? 'unspecified' });
    return true;
  } catch (err) {
    if (TERMINAL_CALL_ERRORS.has(err?.code)) {
      log.debug('call already terminal', { callSid, code: err.code });
      return true;
    }
    // Ringing legs sometimes reject `completed`; `canceled` is the right verb.
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

/**
 * Replace the TwiML a live call is executing. This is how a leg that was
 * forking audio into `<Connect><Stream>` gets bridged onto the agent: the
 * update interrupts the stream verb and immediately executes the new document.
 *
 * @param {string} callSid
 * @param {string} twiml raw TwiML document
 */
export async function redirectCall(callSid, twiml) {
  const rest = getTwilioClient();
  return rest.calls(callSid).update({ twiml });
}

/**
 * Mint a Voice SDK access token for the browser workstation.
 * @param {string} identity client identity, e.g. `agent_1`
 */
export function createVoiceAccessToken(identity) {
  const { accountSid, apiKeySid, apiKeySecret, twimlAppSid, tokenTtlSeconds } = config.twilio;
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error('Cannot mint a voice token: TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET are not configured');
  }

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: tokenTtlSeconds,
  });

  token.addGrant(
    new VoiceGrant({
      // Present so the agent can also place manual outbound calls from the UI.
      outgoingApplicationSid: twimlAppSid || undefined,
      // Required: connected leads arrive as inbound calls to this identity.
      incomingAllow: true,
    }),
  );

  return { token: token.toJwt(), identity, expiresInSeconds: tokenTtlSeconds };
}

/**
 * Express middleware validating the `X-Twilio-Signature` header on webhooks.
 * Skipped when `TWILIO_VALIDATE_SIGNATURE=false` (local tunnels, unit tests).
 */
export function twilioWebhookAuth() {
  return (req, res, next) => {
    if (!config.twilio.validateSignature) return next();

    const signature = req.get('X-Twilio-Signature');
    const url = `${config.publicBaseUrl}${req.originalUrl}`;
    const valid = twilio.validateRequest(config.twilio.authToken, signature ?? '', url, req.body ?? {});

    if (!valid) {
      log.warn('rejected unsigned Twilio webhook', { path: req.originalUrl });
      return res.status(403).type('text/plain').send('Invalid Twilio signature');
    }
    return next();
  };
}

export default { getTwilioClient, hangupCall, redirectCall, createVoiceAccessToken, twilioWebhookAuth };
