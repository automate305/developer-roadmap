/**
 * Thin facade over sip.js's `SimpleUser` so DialerDevice.jsx can treat a
 * SignalWire SIP session exactly like a Twilio Voice SDK `Call`: `.on(event,
 * handler)`, `.accept()`, `.reject()`, `.disconnect()`, `.mute(bool)`,
 * `.isMuted()`, `.parameters`. DialerDevice.jsx's call-handling code
 * (attachCall, acceptCall, toggleMute, hangUp) was written against that
 * shape for Twilio; this is what lets it run unmodified for SignalWire too,
 * rather than forking every call-site on `provider`.
 *
 * `SimpleUser` deliberately supports only one concurrent session
 * (`maxSimultaneousSessions: 1`), which matches this app exactly — one
 * inbound bridge at a time, same as the Twilio Voice SDK `Device` here.
 *
 * What this facade can NOT do, because `SimpleUser`'s public API doesn't
 * expose it: read the inbound INVITE's From header. Twilio's `Call.
 * parameters.From` is already documented in DialerDevice.jsx as unreliable
 * (it's this agency's own caller ID, not the lead's — see
 * `connectedLegRef`'s comment there) and is only ever used as a last-resort
 * fallback behind the SSE-derived lead info; `.parameters` is kept here as
 * an always-empty object so that fallback chain doesn't throw, not because
 * it carries real data.
 */

/**
 * @param {import('sip.js/lib/platform/web/simple-user/simple-user.js').SimpleUser} user
 * @returns {{
 *   parameters: object,
 *   on: (event: string, handler: (...args: any[]) => void) => void,
 *   accept: () => Promise<void>,
 *   reject: () => Promise<void>,
 *   disconnect: () => Promise<void>,
 *   mute: (shouldMute: boolean) => void,
 *   isMuted: () => boolean,
 *   emit: (event: string, ...args: any[]) => void,
 * }}
 */
export function createSignalwireCallAdapter(user) {
  const listeners = new Map();

  const on = (event, handler) => {
    const bucket = listeners.get(event) ?? [];
    bucket.push(handler);
    listeners.set(event, bucket);
  };

  const emit = (event, ...args) => {
    for (const handler of listeners.get(event) ?? []) handler(...args);
  };

  return {
    // Twilio's own Call.parameters is also mostly-unreliable here (see doc
    // comment above) — always-empty keeps the same optional-chaining call
    // sites working without a provider check.
    parameters: {},
    on,
    accept: () => user.answer(),
    reject: () => user.decline(),
    disconnect: () => user.hangup(),
    mute: (shouldMute) => (shouldMute ? user.mute() : user.unmute()),
    isMuted: () => user.isMuted(),
    emit,
  };
}

/**
 * Approximate mic/far-end level metering for the SignalWire path.
 *
 * The Twilio Voice SDK's `call.on('volume', (input, output) => …)` has no
 * equivalent on `SimpleUser` — there is no per-call volume event at all —
 * so this polls `AnalyserNode.getByteFrequencyData()` against
 * `user.localMediaStream`/`user.remoteMediaStream` instead. This is a
 * best-effort stand-in: ~100ms resolution, a crude average-of-frequency-bins
 * normalisation rather than Twilio's (undocumented, presumably RMS-based)
 * figure, and it has not been tuned against real call audio. Good enough to
 * light up the existing Mic/Lead meters in DialerDevice.jsx; treat the exact
 * numbers as illustrative, not calibrated.
 *
 * @param {import('sip.js/lib/platform/web/simple-user/simple-user.js').SimpleUser} user
 * @param {(input: number, output: number) => void} onLevels values in [0, 1]
 * @returns {() => void} stop metering and release the AudioContext
 */
export function attachVolumeMeter(user, onLevels) {
  const AudioCtx = typeof window !== 'undefined' ? window.AudioContext ?? window.webkitAudioContext : null;
  if (!AudioCtx) return () => {};

  let ctx;
  try {
    ctx = new AudioCtx();
  } catch {
    return () => {};
  }

  const makeAnalyser = (stream) => {
    if (!stream || stream.getAudioTracks().length === 0) return null;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      return analyser;
    } catch {
      return null;
    }
  };

  const localAnalyser = makeAnalyser(user.localMediaStream);
  const remoteAnalyser = makeAnalyser(user.remoteMediaStream);
  const bins = new Uint8Array(128);

  const level = (analyser) => {
    if (!analyser) return 0;
    analyser.getByteFrequencyData(bins);
    let sum = 0;
    for (let i = 0; i < bins.length; i += 1) sum += bins[i];
    return Math.min(1, sum / bins.length / 128);
  };

  const interval = setInterval(() => {
    onLevels(level(localAnalyser), level(remoteAnalyser));
  }, 100);

  return () => {
    clearInterval(interval);
    ctx.close().catch(() => {
      /* already closed */
    });
  };
}

export default { createSignalwireCallAdapter, attachVolumeMeter };
