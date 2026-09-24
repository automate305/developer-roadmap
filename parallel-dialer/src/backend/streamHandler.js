/**
 * streamHandler.js — Twilio Media Streams → Deepgram relay + AMD state machine.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Twilio's built-in `machineDetection` costs 2–4 seconds because it waits for a
 * greeting to finish. A parallel dialer cannot pay that: the agent hears dead
 * air while three other lines ring out. Instead we fork the inbound audio the
 * instant the leg answers and decide from the first words.
 *
 * ── Zero-transcode hot path ──────────────────────────────────────────────────
 * Twilio sends base64 μ-law, 8 kHz, mono, in 20 ms frames. Deepgram accepts
 * exactly that (`encoding: 'mulaw', sample_rate: 8000`), so each frame is
 * base64-decoded once and forwarded. No resampling, no PCM conversion, no
 * ffmpeg — the only work on the hot path is `Buffer.from(payload, 'base64')`.
 *
 * ── State machine ────────────────────────────────────────────────────────────
 *
 *   IDLE ──start──▶ LISTENING ──┬─ machine phrase in transcript ──▶ MACHINE
 *                               ├─ greeting phrase in transcript ─▶ HUMAN
 *                               ├─ speech block > 2.8 s ──────────▶ MACHINE
 *                               ├─ no speech by 3.8 s ────────────▶ NO_ANSWER
 *                               └─ 9 s hard deadline ─────────────▶ MACHINE
 *
 *   Any state ──socket close before a verdict──▶ ABORTED (no classification)
 *
 * Timers explained:
 *   INITIAL_SPEECH_TIMEOUT (3.8 s) — armed on `start`. Dead air this long after
 *     answer means an IVR that answered silently, a dropped carrier leg, or a
 *     machine whose greeting has not begun. Nothing worth an agent.
 *   MAX_CONTINUOUS_SPEECH (2.8 s) — armed when speech starts, cleared when it
 *     stops. A human says "Hello?" and waits; only a recording talks straight
 *     through 2.8 seconds without a pause.
 *   DECISION_DEADLINE (9 s) — belt and braces. If neither timer nor the
 *     classifier has fired, release the line rather than hold it open.
 */
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { dialerEngine } from './dialerEngine.js';

const log = logger.child({ module: 'streamHandler' });

export const AmdState = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  DECIDED: 'DECIDED',
  ABORTED: 'ABORTED',
});

export const Classification = Object.freeze({
  HUMAN: 'HUMAN',
  MACHINE: 'MACHINE',
  NO_ANSWER: 'NO_ANSWER',
});

/**
 * Voicemail / IVR giveaways. Any hit is decisive — a live human does not open
 * a call with "you've reached". Ordered roughly by observed frequency.
 */
export const MACHINE_PATTERNS = [
  /\byou(?:'| ha)?ve reached\b/i,
  /\bleave (?:a|your) (?:message|name)\b/i,
  /\bafter the (?:tone|beep)\b/i,
  /\bat the (?:tone|beep)\b/i,
  /\bis not available\b/i,
  /\bnot available (?:right now|at the moment|to take)\b/i,
  /\bunable to (?:take|answer) (?:your|the) call\b/i,
  /\bplease record your message\b/i,
  /\bvoice ?mail\b/i,
  /\bmailbox\b/i,
  /\bthe (?:person|party|subscriber) you (?:are|have) (?:trying to|dialed)\b/i,
  /\bthank you for calling\b/i,
  /\bpress (?:one|two|three|four|[1-9])\b/i,
  /\bfor (?:english|spanish|sales|support|billing),? press\b/i,
  /\bhas been (?:disconnected|forwarded)\b/i,
  /\bno longer in service\b/i,
  /\bgoogle (?:voice|subscriber)\b/i,
  /\brecord your message\b/i,
  /\bwhen you(?:'re| are) (?:done|finished)\b/i,
];

/**
 * Openers a live person uses. Matched only at the very start of the utterance
 * so "hi, you've reached Dave's HVAC" cannot be mistaken for a human — the
 * machine patterns are evaluated first regardless.
 */
export const HUMAN_GREETINGS = [
  /^(?:uh |um |er )?h[ae]llo\b/i,
  /^(?:uh |um )?hi\b/i,
  /^(?:uh |um )?hey\b/i,
  /^yeah\b/i,
  /^yep\b/i,
  /^yes\b/i,
  /^yo\b/i,
  /^speaking\b/i,
  /^this is \w+/i,
  /^good (?:morning|afternoon|evening)\b/i,
  /^(?:who(?:'s| is) (?:this|calling))\b/i,
  /^(?:can|may) i help you\b/i,
  /^how can i help\b/i,
  /^\w+ (?:here|speaking)\b/i,
];

/** A human greeting is short. Anything longer is a scripted recording. */
export const HUMAN_MAX_WORDS = 7;

/**
 * Pure classifier over a transcript fragment. Exported so the decision logic is
 * unit-testable without a socket or an API key.
 *
 * @param {string} text raw transcript (interim or final)
 * @returns {{ classification: 'HUMAN'|'MACHINE'|null, reason: string|null }}
 */
export function classifyTranscript(text) {
  const clean = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return { classification: null, reason: null };

  // Machine first: a voicemail greeting often *starts* with "hi" or "hello".
  for (const pattern of MACHINE_PATTERNS) {
    if (pattern.test(clean)) {
      return { classification: Classification.MACHINE, reason: `machine_phrase:${pattern.source.slice(0, 40)}` };
    }
  }

  const words = clean.split(' ').filter(Boolean);
  if (words.length <= HUMAN_MAX_WORDS) {
    for (const pattern of HUMAN_GREETINGS) {
      if (pattern.test(clean)) {
        return { classification: Classification.HUMAN, reason: `greeting:${clean.slice(0, 40)}` };
      }
    }
  }

  return { classification: null, reason: null };
}

/**
 * One live call leg: owns the Twilio socket, the Deepgram socket, and the
 * timers that make the classification decision.
 */
export class AmdStreamSession {
  /**
   * @param {import('ws').WebSocket} twilioSocket
   * @param {object} [deps]
   * @param {object} [deps.engine] dialer engine (injectable for tests)
   * @param {(opts: object) => object} [deps.createDeepgram] factory returning a live connection
   */
  constructor(twilioSocket, deps = {}) {
    this.socket = twilioSocket;
    this.engine = deps.engine ?? dialerEngine;
    this.createDeepgram = deps.createDeepgram ?? defaultDeepgramFactory;

    this.state = AmdState.IDLE;
    this.streamSid = null;
    this.callSid = null;
    this.legId = null;
    this.log = log;

    /** @type {object|null} */ this.dg = null;
    this.dgReady = false;
    /** Frames that arrived before Deepgram finished its handshake. */
    /** @type {Buffer[]} */ this.pendingFrames = [];
    this.framesForwarded = 0;
    this.bytesForwarded = 0;

    this.answeredAt = null;
    this.speechDetected = false;
    this.speechStartedAt = null;
    this.transcript = '';

    /** @type {Record<string, NodeJS.Timeout|null>} */
    this.timers = { initialSpeech: null, continuousSpeech: null, deadline: null, keepAlive: null };

    this.#wireTwilioSocket();
  }

  // ─────────────────────────────────────────────────────── Twilio socket ────

  #wireTwilioSocket() {
    this.socket.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return; // Twilio only ever sends JSON; ignore anything else.
      }
      this.#onTwilioFrame(frame);
    });

    this.socket.on('close', (code) => {
      this.log.debug('twilio stream closed', { streamSid: this.streamSid, code });
      this.#abort('twilio_socket_closed');
    });

    this.socket.on('error', (err) => {
      this.log.warn('twilio stream error', { streamSid: this.streamSid, err });
      this.#abort('twilio_socket_error');
    });
  }

  #onTwilioFrame(frame) {
    switch (frame.event) {
      case 'connected':
        this.log.debug('twilio media stream connected', { protocol: frame.protocol });
        break;

      case 'start':
        this.#onStart(frame.start ?? {});
        break;

      case 'media':
        this.#onMedia(frame.media ?? {});
        break;

      case 'mark':
        this.log.trace('mark', { name: frame.mark?.name, streamSid: this.streamSid });
        break;

      case 'stop':
        this.log.debug('twilio stream stop', { streamSid: this.streamSid });
        this.#abort('twilio_stream_stop');
        break;

      default:
        break;
    }
  }

  /**
   * Twilio's `start` frame carries the call SID and any `<Parameter>` values
   * we embedded in the TwiML, which is how a socket finds its dialer leg.
   */
  #onStart(start) {
    this.streamSid = start.streamSid ?? null;
    this.callSid = start.callSid ?? null;
    this.legId = start.customParameters?.legId ?? null;

    this.log = log.child({ streamSid: this.streamSid, callSid: this.callSid, legId: this.legId });
    this.answeredAt = Date.now();
    this.state = AmdState.LISTENING;

    const leg = this.engine.bindStream({ legId: this.legId, callSid: this.callSid, streamSid: this.streamSid });
    if (!leg) this.log.warn('media stream has no matching dialer leg — classifying anyway');

    this.log.info('amd listening', {
      initialSpeechTimeoutMs: config.amd.initialSpeechTimeoutMs,
      maxContinuousSpeechMs: config.amd.maxContinuousSpeechMs,
    });

    this.#armInitialSpeechTimer();
    this.#armDeadline();
    this.#openDeepgram();
  }

  /**
   * Hot path. Runs ~50×/second per leg × N legs — keep it allocation-light.
   */
  #onMedia(media) {
    if (this.state !== AmdState.LISTENING) return;
    if (!media.payload) return;

    const frame = Buffer.from(media.payload, 'base64');
    this.framesForwarded += 1;
    this.bytesForwarded += frame.length;

    if (this.dgReady && this.dg) {
      try {
        this.dg.send(frame);
      } catch (err) {
        this.log.warn('deepgram send failed', { err });
      }
      return;
    }

    // Deepgram handshake is still in flight. Hold a bounded backlog (~2 s of
    // audio) so the opening word is not lost, and drop the oldest beyond that.
    this.pendingFrames.push(frame);
    if (this.pendingFrames.length > 100) this.pendingFrames.shift();
  }

  // ──────────────────────────────────────────────────────────── Deepgram ────

  #openDeepgram() {
    if (!config.deepgram.apiKey) {
      // Degraded mode: no transcripts, so only the timers can classify. The
      // 3.8 s dead-air timer still releases the line.
      this.log.warn('DEEPGRAM_API_KEY unset — running timeout-only AMD');
      return;
    }

    try {
      this.dg = this.createDeepgram({
        model: config.deepgram.model,
        encoding: config.deepgram.encoding,
        sample_rate: config.deepgram.sampleRate,
        channels: config.deepgram.channels,
        endpointing: config.deepgram.endpointingMs,
      });
    } catch (err) {
      this.log.error('failed to open deepgram connection', { err });
      return;
    }

    this.dg.on(LiveTranscriptionEvents.Open, () => {
      this.dgReady = true;
      this.log.debug('deepgram open', { buffered: this.pendingFrames.length });

      // Flush the pre-handshake backlog in order, then release the array.
      for (const frame of this.pendingFrames) {
        try {
          this.dg.send(frame);
        } catch (err) {
          this.log.warn('deepgram backlog send failed', { err });
          break;
        }
      }
      this.pendingFrames = [];

      // Deepgram closes idle sockets; a silent leg must not lose its stream.
      this.timers.keepAlive = setInterval(() => {
        try {
          this.dg?.keepAlive?.();
        } catch { /* connection already closing */ }
      }, 5000);
    });

    this.dg.on(LiveTranscriptionEvents.Transcript, (data) => this.#onTranscript(data));

    // VAD: speech onset arrives before any transcript, so the continuous-speech
    // timer starts at the true beginning of the greeting.
    this.dg.on(LiveTranscriptionEvents.SpeechStarted, () => this.#onSpeechStarted('vad'));

    // Endpointing found a real pause — the speaker stopped. Humans pause.
    this.dg.on(LiveTranscriptionEvents.UtteranceEnd, () => this.#onSpeechEnded('utterance_end'));

    this.dg.on(LiveTranscriptionEvents.Error, (err) => {
      this.log.warn('deepgram error', { err: err?.message ?? String(err) });
    });

    this.dg.on(LiveTranscriptionEvents.Close, () => {
      this.dgReady = false;
      this.log.debug('deepgram closed', { framesForwarded: this.framesForwarded });
    });
  }

  #onTranscript(data) {
    if (this.state !== AmdState.LISTENING) return;

    const alternative = data?.channel?.alternatives?.[0];
    const text = alternative?.transcript ?? '';
    if (!text.trim()) return;

    // Any transcribed word counts as speech, even an interim one.
    this.#onSpeechStarted('transcript');

    // Interim results are provisional: they are classified but not retained.
    // Only finals are appended to the running transcript sent to the CRM.
    const candidate = `${this.transcript} ${text}`.trim();
    if (data?.is_final) this.transcript = candidate;

    const { classification, reason } = classifyTranscript(text);
    this.log.trace('transcript', { text, isFinal: Boolean(data?.is_final), classification });

    if (classification) {
      this.#decide(classification, reason ?? 'transcript', candidate);
      return;
    }

    // A long non-matching utterance is a recording reading a script.
    const wordCount = candidate.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 14) {
      this.#decide(Classification.MACHINE, `long_utterance:${wordCount}_words`, candidate);
      return;
    }

    if (data?.speech_final) this.#onSpeechEnded('speech_final');
  }

  // ────────────────────────────────────────────────────── state machine ────

  /** LISTENING: first speech seen — cancel dead-air timer, arm the speech-block timer. */
  #onSpeechStarted(source) {
    if (this.state !== AmdState.LISTENING) return;

    if (!this.speechDetected) {
      this.speechDetected = true;
      this.#clearTimer('initialSpeech');
      this.log.debug('speech detected', { source, msAfterAnswer: Date.now() - this.answeredAt });
    }

    if (this.speechStartedAt === null) {
      this.speechStartedAt = Date.now();
      this.#armContinuousSpeechTimer();
    }
  }

  /** LISTENING: speaker paused — a human trait. Disarm the speech-block timer. */
  #onSpeechEnded(source) {
    if (this.state !== AmdState.LISTENING) return;
    if (this.speechStartedAt === null) return;

    const blockMs = Date.now() - this.speechStartedAt;
    this.speechStartedAt = null;
    this.#clearTimer('continuousSpeech');
    this.log.debug('speech block ended', { source, blockMs });
  }

  /** Armed on `start`. Dead air for 3.8 s ⇒ nothing worth an agent. */
  #armInitialSpeechTimer() {
    this.timers.initialSpeech = setTimeout(() => {
      if (this.speechDetected) return;
      this.#decide(Classification.NO_ANSWER, `dead_air_${config.amd.initialSpeechTimeoutMs}ms`, this.transcript);
    }, config.amd.initialSpeechTimeoutMs);
  }

  /** Armed when speech starts, cleared when it stops. Firing ⇒ a recording. */
  #armContinuousSpeechTimer() {
    this.#clearTimer('continuousSpeech');
    this.timers.continuousSpeech = setTimeout(() => {
      if (this.speechStartedAt === null) return; // speech ended in the meantime
      this.#decide(
        Classification.MACHINE,
        `continuous_speech_${config.amd.maxContinuousSpeechMs}ms`,
        this.transcript,
      );
    }, config.amd.maxContinuousSpeechMs);
  }

  /** Hard ceiling so a leg can never sit open waiting on a verdict. */
  #armDeadline() {
    this.timers.deadline = setTimeout(() => {
      this.#decide(Classification.MACHINE, `decision_deadline_${config.amd.decisionDeadlineMs}ms`, this.transcript);
    }, config.amd.decisionDeadlineMs);
  }

  /**
   * Terminal transition. Idempotent: the first caller wins, later timers no-op.
   * @param {'HUMAN'|'MACHINE'|'NO_ANSWER'} classification
   */
  #decide(classification, reason, transcript) {
    if (this.state !== AmdState.LISTENING) return;
    this.state = AmdState.DECIDED;

    const latencyMs = this.answeredAt ? Date.now() - this.answeredAt : null;
    this.#clearAllTimers();

    this.log.info('amd decision', { classification, reason, latencyMs, transcript: transcript?.slice(0, 200) });

    Promise.resolve(
      this.engine.classify(
        { legId: this.legId, callSid: this.callSid },
        classification,
        { transcript: (transcript ?? '').trim(), latencyMs, reason },
      ),
    ).catch((err) => this.log.error('classification handler failed', { err }));

    // Release the Deepgram socket immediately — the verdict is in and every
    // further frame is billable noise.
    //
    // The Twilio socket is deliberately NOT closed here. Under
    // `<Connect><Stream>` the stream verb *is* the call: closing the socket
    // advances the call to the next TwiML verb, and there isn't one, so Twilio
    // would hang up. On a HUMAN that would kill the very leg we are about to
    // bridge, racing the `<Dial>` redirect. Let the engine's REST action end
    // the call — the redirect or the hangup closes this socket for us.
    this.#closeDeepgram();
  }

  /** Socket died before a verdict — release resources, classify nothing. */
  #abort(reason) {
    if (this.state === AmdState.ABORTED) return;
    const wasListening = this.state === AmdState.LISTENING;
    this.state = this.state === AmdState.DECIDED ? AmdState.DECIDED : AmdState.ABORTED;

    this.#clearAllTimers();
    this.#closeDeepgram();

    if (wasListening) {
      this.log.debug('amd aborted before decision', { reason, speechDetected: this.speechDetected });
    }
  }

  #closeDeepgram() {
    this.dgReady = false;
    if (!this.dg) return;
    try {
      // SDK 3.x renamed `finish()` to `requestClose()`; support both.
      if (typeof this.dg.requestClose === 'function') this.dg.requestClose();
      else if (typeof this.dg.finish === 'function') this.dg.finish();
    } catch (err) {
      this.log.debug('deepgram close threw', { err: err?.message });
    }
    this.dg = null;
  }

  #clearTimer(name) {
    if (!this.timers[name]) return;
    clearTimeout(this.timers[name]);
    clearInterval(this.timers[name]);
    this.timers[name] = null;
  }

  #clearAllTimers() {
    for (const name of Object.keys(this.timers)) this.#clearTimer(name);
  }
}

/** Default Deepgram live-connection factory. */
function defaultDeepgramFactory(options) {
  const deepgram = createClient(config.deepgram.apiKey);
  return deepgram.listen.live({
    model: options.model,
    // Match Twilio's wire format exactly — no transcoding on the hot path.
    encoding: options.encoding,
    sample_rate: options.sample_rate,
    channels: options.channels,
    // Interim results are what make a sub-300 ms human verdict possible: the
    // first word is classified without waiting for the utterance to finalize.
    interim_results: true,
    // Short endpointing keeps `speech_final` close to the real pause.
    endpointing: options.endpointing,
    utterance_end_ms: 1000,
    vad_events: true,
    // Formatting costs latency and buys nothing for phrase matching.
    punctuate: false,
    smart_format: false,
    filler_words: true,
    language: 'en-US',
  });
}

/**
 * WebSocket connection handler for `/media-stream`.
 * @param {import('ws').WebSocket} socket
 * @param {import('node:http').IncomingMessage} _req
 * @param {object} [deps]
 */
export function handleMediaStreamConnection(socket, _req, deps = {}) {
  return new AmdStreamSession(socket, deps);
}

export default handleMediaStreamConnection;
