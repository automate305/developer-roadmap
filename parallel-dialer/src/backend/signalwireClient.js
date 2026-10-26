/**
 * Shared SignalWire REST client plus the small helpers the dialer needs on
 * the latency-critical path (hangups, live cXML redirects, browser tokens).
 *
 * Mirrors twilioClient.js's exports 1:1 on purpose — telephonyClient.js picks
 * between the two at module load based on `config.telephony.provider`, and
 * every caller (dialerEngine.js, routes/*.js) imports from telephonyClient.js
 * only, never from this file or twilioClient.js directly.
 *
 * SignalWire's Compatibility API (`@signalwire/compatibility-api`) is a
 * documented near-drop-in for the `twilio` package's REST client and TwiML
 * builder — same `.calls.create()`, same `.calls(sid).update()`, same
 * `RestClient.LaML.VoiceResponse` verb methods as `twilio.twiml.VoiceResponse`.
 * What it does NOT have is a Twilio-Voice-SDK equivalent for the browser leg
 * — see telephonyClient.js#buildAgentDialNoun for how that gap is bridged.
 */
import { RestClient } from '@signalwire/compatibility-api';
import crypto from 'node:crypto';

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'signalwireClient' });

/** @type {ReturnType<typeof RestClient> | null} */
let client = null;

/**
 * Lazily construct the REST client so the process still boots (and serves
 * /health) when SignalWire credentials are absent in a test environment.
 */
export function getSignalwireClient() {
  if (client) return client;
  const { projectId, apiToken, spaceUrl } = config.signalwire;
  if (!projectId || !apiToken || !spaceUrl) {
    throw new Error(
      'SignalWire credentials are not configured (SIGNALWIRE_PROJECT_ID / SIGNALWIRE_API_TOKEN / SIGNALWIRE_SPACE_URL)',
    );
  }
  client = RestClient(projectId, apiToken, { signalwireSpaceUrl: spaceUrl });
  return client;
}

/**
 * Error codes that mean "the call already ended" — safe to ignore.
 * The Compatibility API reuses Twilio's numeric error-code space for status
 * transitions (documented as part of the "minimal code changes" promise), so
 * this set is carried over unchanged from twilioClient.js. Unverified against
 * a live SignalWire account — if hangupCall ever logs a warning for a call
 * that's clearly already gone, this is the first place to look.
 */
const TERMINAL_CALL_ERRORS = new Set([
  20404, // resource not found (call already reaped)
  21220, // invalid call state transition
]);

/**
 * Hang up a call, tolerating the race where the far end disconnects first.
 * Same two-step completed→canceled fallback as twilioClient.js, for the same
 * reason: a ringing leg sometimes rejects `completed`.
 *
 * @param {string} callSid
 * @param {{ reason?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function hangupCall(callSid, opts = {}) {
  const rest = getSignalwireClient();
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

/**
 * Replace the cXML a live call is executing — SignalWire's REST `update`
 * with a `twiml` body works the same way Twilio's does.
 * @param {string} callSid
 * @param {string} twiml raw cXML document
 */
export async function redirectCall(callSid, twiml) {
  const rest = getSignalwireClient();
  return rest.calls(callSid).update({ twiml });
}

/**
 * Hand out SIP registration credentials for the browser softphone.
 *
 * This does NOT mint a Call Fabric Subscriber Access Token, even though
 * that is SignalWire's modern, documented browser-auth mechanism — a Call
 * Fabric Subscriber has no address a Compatibility API `<Dial>` can reach
 * (see telephonyClient.js#buildAgentDialNoun for the full reasoning), so a
 * SAT would let the browser connect but the engine could never bridge a
 * winning leg onto it. Instead this returns the credentials for the classic
 * SignalWire SIP Endpoint the agent's browser registers as over WebSocket
 * (SIP.js on the frontend — see DialerDevice.jsx's SignalWire branch), which
 * IS reachable from cXML via `<Dial><Sip>`.
 *
 * Only one static SIP Endpoint is configured (`SIGNALWIRE_SIP_ENDPOINT_*`),
 * matching this app's existing single-agent scope (AGENTS.md: "routing
 * across more than one agent" is still unimplemented). `identity` is
 * accepted for symmetry with the Twilio path's per-identity tokens, but it
 * is only checked, not used to mint anything per-identity — a mismatch is
 * logged because it means the engine will build a `<Sip>` URI the SIP
 * Endpoint was never registered to answer.
 *
 * @param {string} identity expected to equal `SIGNALWIRE_SIP_ENDPOINT_USERNAME`
 */
export async function createVoiceAccessToken(identity) {
  const { spaceUrl, sipEndpointUsername, sipEndpointPassword, tokenTtlSeconds } = config.signalwire;
  if (!spaceUrl || !sipEndpointUsername || !sipEndpointPassword) {
    throw new Error(
      'Cannot hand out SIP credentials: SIGNALWIRE_SPACE_URL / SIGNALWIRE_SIP_ENDPOINT_USERNAME / ' +
        'SIGNALWIRE_SIP_ENDPOINT_PASSWORD are not configured',
    );
  }

  if (identity !== sipEndpointUsername) {
    log.warn('requested identity does not match the configured SIP Endpoint username — a bridge to this ' +
      'agent will build a <Sip> URI the endpoint was never registered to answer', { identity, sipEndpointUsername });
  }

  return {
    // Not a JWT — the SIP Endpoint's plain-text password, used by SIP.js as
    // `authorizationPassword`. Field named `token` to keep the frontend's
    // `/api/token` contract uniform across both providers.
    token: sipEndpointPassword,
    identity: sipEndpointUsername,
    expiresInSeconds: tokenTtlSeconds,
    // Extra fields the Twilio path has no use for — SIP.js needs the
    // WebSocket server and SIP domain explicitly; a JWT carries no such
    // thing to parse them out of.
    sipDomain: spaceUrl,
    wsServer: `wss://${spaceUrl}`,
  };
}

/**
 * Compute the signature Twilio-style webhook validation expects: HMAC-SHA1
 * over the callback URL with every POSTed form field appended as
 * `key + value`, sorted by key, base64-encoded. This is Twilio's published
 * algorithm; SignalWire's Compatibility API is documented to send webhooks
 * that are drop-in compatible with Twilio's own signature validation, which
 * is why this is reimplemented here rather than imported — there is no
 * confirmed `RestClient.validateRequest` export in
 * `@signalwire/compatibility-api` as of this migration. Treat this function
 * as unverified until it has rejected/accepted a real SignalWire webhook.
 */
function computeSignature(signingKey, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', signingKey).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/**
 * Express middleware validating a SignalWire voice webhook's signature.
 * Skipped when `SIGNALWIRE_VALIDATE_SIGNATURE=false` (local tunnels, unit
 * tests). SignalWire is documented to sign with the same scheme Twilio uses;
 * the header name below (`X-SignalWire-Signature`) falls back to Twilio's
 * header name too, since some SignalWire Compatibility API deployments have
 * been reported to send the Twilio-named header for drop-in compatibility —
 * this fallback is a hedge, not a confirmed fact, and should be revisited
 * once this has run against a real SignalWire webhook.
 */
export function signalwireWebhookAuth() {
  return (req, res, next) => {
    if (!config.signalwire.validateSignature) return next();

    const signature = req.get('X-SignalWire-Signature') ?? req.get('X-Twilio-Signature');
    const url = `${config.publicBaseUrl}${req.originalUrl}`;
    const expected = computeSignature(config.signalwire.apiToken ?? '', url, req.body ?? {});

    const valid =
      Boolean(signature) &&
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!valid) {
      log.warn('rejected unsigned SignalWire webhook', { path: req.originalUrl });
      return res.status(403).type('text/plain').send('Invalid SignalWire signature');
    }
    return next();
  };
}

export default {
  getSignalwireClient,
  hangupCall,
  redirectCall,
  createVoiceAccessToken,
  signalwireWebhookAuth,
};
