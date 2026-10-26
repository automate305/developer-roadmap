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
 * SignalWire phone-bridge stub — the browser doesn't handle audio; instead,
 * answered calls are bridged to the agent's phone via <Number> in the backend.
 * This no-op device satisfies the frontend lifecycle without crashing.
 */
function createSignalWireDevice(_token, _opts) {
  const handlers = new Map();
  return {
    _provider: 'signalwire',
    _phoneBridge: true,
    register() {
      queueMicrotask(() => handlers.get('registered')?.());
    },
    destroy() {},
    updateToken() {},
    on(event, fn) { handlers.set(event, fn); return this; },
    off(event) { handlers.delete(event); return this; },
    emit(event, ...args) { handlers.get(event)?.(...args); },
  };
}

export default createVoiceDevice;
