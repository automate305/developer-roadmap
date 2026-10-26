/**
 * Voice provider abstraction — delegates to Twilio or SignalWire based on
 * the VOICE_PROVIDER env var.
 *
 * Every consumer that previously imported from `twilioClient.js` now imports
 * from here instead. The exported function names are identical, so the
 * call sites need only a path change.
 */
import { config } from '../config/env.js';

import {
  getTwilioClient,
  hangupCall as twilioHangup,
  redirectCall as twilioRedirect,
  createVoiceAccessToken as twilioToken,
  twilioWebhookAuth,
} from './twilioClient.js';

import {
  getSignalWireClient,
  hangupCall as swHangup,
  redirectCall as swRedirect,
  createVoiceAccessToken as swToken,
  signalwireWebhookAuth,
} from './signalwireClient.js';

const isSignalWire = config.voiceProvider === 'signalwire';

export function getVoiceClient() {
  return isSignalWire ? getSignalWireClient() : getTwilioClient();
}

export async function hangupCall(callSid, opts) {
  return isSignalWire ? swHangup(callSid, opts) : twilioHangup(callSid, opts);
}

export async function redirectCall(callSid, twiml) {
  return isSignalWire ? swRedirect(callSid, twiml) : twilioRedirect(callSid, twiml);
}

export async function createVoiceAccessToken(identity) {
  return isSignalWire ? swToken(identity) : twilioToken(identity);
}

export function webhookAuth() {
  return isSignalWire ? signalwireWebhookAuth() : twilioWebhookAuth();
}

export function getCallerId() {
  return isSignalWire ? config.signalwire.callerId : config.twilio.callerId;
}

export function getAuthSecret() {
  return isSignalWire ? config.signalwire.apiToken : config.twilio.authToken;
}

export default {
  getVoiceClient,
  hangupCall,
  redirectCall,
  createVoiceAccessToken,
  webhookAuth,
  getCallerId,
  getAuthSecret,
};
