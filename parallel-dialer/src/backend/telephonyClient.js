/**
 * telephonyClient.js — the one place that knows which vendor is live.
 *
 * `config.telephony.provider` (`TELEPHONY_PROVIDER` env var) picks Twilio or
 * SignalWire; every other backend module imports call-placing/call-control
 * primitives from HERE, never from twilioClient.js or signalwireClient.js
 * directly. That is what makes the switch a one-env-var operation instead of
 * a code change: dialerEngine.js, routes/twiml.js and routes/api.js are
 * unaware which vendor they are talking to.
 *
 * Twilio's REST/TwiML surface and SignalWire's Compatibility API REST/cXML
 * surface are close enough (same verb methods, same call-create/update
 * shape) that everything below except `buildAgentDialNoun` is a straight
 * pick-one-implementation dispatch, not a translation layer.
 */
import twilio from 'twilio';
import { RestClient } from '@signalwire/compatibility-api';

import { config } from '../config/env.js';
import { escapeXml } from '../utils/xml.js';
import * as twilioImpl from './twilioClient.js';
import * as signalwireImpl from './signalwireClient.js';

export const provider = config.telephony.provider === 'signalwire' ? 'signalwire' : 'twilio';
const usingSignalwire = provider === 'signalwire';

/**
 * The TwiML/cXML response builder constructor. Twilio: `twilio.twiml.VoiceResponse`.
 * SignalWire: `RestClient.LaML.VoiceResponse` — documented as implementing
 * the same verb methods (`.say()`, `.dial()`, `.connect().stream()`,
 * `.hangup()`, `.number()`, `.parameter()`) used throughout routes/twiml.js,
 * so that file needed no changes beyond its import line.
 */
export const VoiceResponse = usingSignalwire ? RestClient.LaML.VoiceResponse : twilio.twiml.VoiceResponse;

/** Lazily-constructed REST client for the active provider. */
export const getClient = usingSignalwire ? signalwireImpl.getSignalwireClient : twilioImpl.getTwilioClient;

/** Hang up a call, tolerating the already-terminal race. */
export const hangupCall = usingSignalwire ? signalwireImpl.hangupCall : twilioImpl.hangupCall;

/** Replace the TwiML/cXML a live call is executing. */
export const redirectCall = usingSignalwire ? signalwireImpl.redirectCall : twilioImpl.redirectCall;

/** Mint a browser-softphone access token for the given agent identity. */
export const createVoiceAccessToken = usingSignalwire
  ? signalwireImpl.createVoiceAccessToken
  : twilioImpl.createVoiceAccessToken;

/** Express middleware validating the active provider's webhook signature. */
export const webhookAuth = usingSignalwire ? signalwireImpl.signalwireWebhookAuth : twilioImpl.twilioWebhookAuth;

/** Outbound caller ID for the active provider. */
export const callerId = usingSignalwire ? config.signalwire.callerId : config.twilio.callerId;

/**
 * The `<Dial>` child noun that reaches the agent's softphone — the one place
 * the two providers genuinely diverge rather than merely rename things.
 *
 * Twilio: `<Client>identity</Client>` bridges straight onto the Voice SDK
 * `Device` registered with that identity — a first-class noun built for
 * exactly this.
 *
 * SignalWire: the Compatibility API's cXML has **no `<Client>` noun**, and
 * `@signalwire/js`'s Call Fabric client (the replacement browser SDK) has no
 * REST-/cXML-reachable address of its own — Subscribers are addressed from
 * *other Call Fabric resources*, not from a Compatibility API `<Dial>`. The
 * closest working equivalent, and the one this migration uses, is a classic
 * SignalWire **SIP Endpoint** (Dashboard → Voice → SIP Endpoints, provisioned
 * by hand — this cannot be done from code, same as a Twilio TwiML App SID
 * isn't minted by this codebase either) registered from the browser with a
 * WebRTC SIP stack (see `frontend/DialerDevice.jsx`'s SignalWire branch,
 * which uses SIP.js instead of `@signalwire/js`).
 *
 * This is the single biggest deviation from the original migration plan
 * (which assumed `@signalwire/js` could replace `@twilio/voice-sdk` as a
 * same-shape Device/Call object) and the single highest-risk assumption in
 * the whole branch: the SIP URI shape below (`sip:{identity}@{spaceUrl}`)
 * matches how a SignalWire SIP Endpoint is dialled from cXML in SignalWire's
 * own docs, but has not been exercised against a live account. Test this
 * first if you pick this branch back up.
 *
 * @param {string} identity agent identity — must equal the SIP Endpoint's
 *   username for SignalWire, or the Voice SDK Device identity for Twilio.
 */
export function buildAgentDialNoun(identity) {
  if (!usingSignalwire) return `<Client>${escapeXml(identity)}</Client>`;
  if (config.dialer.agentPhoneNumber) {
    return `<Number>${escapeXml(config.dialer.agentPhoneNumber)}</Number>`;
  }
  const sipDomain = config.signalwire.spaceUrl;
  return `<Sip>sip:${escapeXml(identity)}@${escapeXml(sipDomain)}</Sip>`;
}

export default {
  provider,
  VoiceResponse,
  getClient,
  hangupCall,
  redirectCall,
  createVoiceAccessToken,
  webhookAuth,
  callerId,
  buildAgentDialNoun,
};
