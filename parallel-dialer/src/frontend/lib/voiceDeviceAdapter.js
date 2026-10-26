/**
 * Voice device adapter — returns a Twilio-shaped Device interface regardless
 * of the active provider.
 *
 * When `provider === 'twilio'`, this is a thin passthrough to
 * `@twilio/voice-sdk`. When `provider === 'signalwire'`, it wraps
 * `@signalwire/js` in the same { register, destroy, updateToken, on } shape
 * so DialerDevice.jsx needs zero conditional logic.
 *
 * NOTE: The SignalWire path is stubbed — `@signalwire/js` is not yet wired.
 * When the SignalWire account clears compliance review and we can test browser
 * calls, flesh out createSignalWireDevice below.
 */
import { Device as TwilioDevice } from '@twilio/voice-sdk';

export function createVoiceDevice(token, opts = {}) {
  const provider = opts.provider ?? 'twilio';

  if (provider === 'signalwire') {
    return createSignalWireDevice(token, opts);
  }
  return createTwilioDevice(token, opts);
}

function createTwilioDevice(token, opts) {
  const device = new TwilioDevice(token, {
    codecPreferences: opts.codecPreferences ?? ['opus', 'pcmu'],
    maxCallSignalingTimeoutMs: opts.maxCallSignalingTimeoutMs ?? 30000,
    enableImprovedSignalingErrorPrecision: true,
    logLevel: opts.logLevel ?? 'error',
  });
  device._provider = 'twilio';
  return device;
}

/**
 * Placeholder for SignalWire browser SDK integration.
 *
 * @signalwire/js uses a different constructor and event model:
 *   const client = await SignalWire({ token });
 *   const call = await client.voice.dial({ ... });
 *
 * This stub throws so the frontend fails loudly rather than silently
 * when someone flips VOICE_PROVIDER=signalwire before the SDK is wired.
 */
function createSignalWireDevice(_token, _opts) {
  throw new Error(
    'SignalWire browser SDK (@signalwire/js) is not yet integrated. ' +
    'The backend REST/LaML/Media Stream path works — browser WebRTC is pending. ' +
    'Set VOICE_PROVIDER=twilio to use the Twilio Voice SDK in the meantime.',
  );
}

export default createVoiceDevice;
