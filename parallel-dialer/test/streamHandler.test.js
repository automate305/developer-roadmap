/**
 * AMD state-machine tests.
 *
 * Timers are shortened via env before the module graph loads. `import`
 * statements are hoisted in ESM, so the modules under test are pulled in with
 * a dynamic `await import()` *after* the assignments — a static import would
 * read the real 3.8 s timeouts and make the suite crawl.
 */
process.env.AMD_INITIAL_SPEECH_TIMEOUT_MS = '150';
process.env.AMD_MAX_CONTINUOUS_SPEECH_MS = '90';
process.env.AMD_DECISION_DEADLINE_MS = '500';
process.env.DEEPGRAM_API_KEY = 'test-key';
process.env.LOG_LEVEL = 'error';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

const { LiveTranscriptionEvents } = await import('@deepgram/sdk');
const { AmdState, AmdStreamSession } = await import('../src/backend/streamHandler.js');

/** Stand-in for the Twilio WebSocket. */
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.closed = false;
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  /** Push a Twilio frame at the session. */
  push(frame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }
}

/** Stand-in for a Deepgram live connection; uses the SDK's real event names. */
class FakeDeepgram extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.closed = false;
  }
  send(chunk) {
    this.sent.push(chunk);
  }
  keepAlive() {}
  requestClose() {
    this.closed = true;
  }
  open() {
    this.emit(LiveTranscriptionEvents.Open);
  }
  /** Emit a transcript in Deepgram's live payload shape. */
  transcript(text, { isFinal = false, speechFinal = false } = {}) {
    this.emit(LiveTranscriptionEvents.Transcript, {
      channel: { alternatives: [{ transcript: text }] },
      is_final: isFinal,
      speech_final: speechFinal,
    });
  }
}

/** Build a session wired to fakes, plus a promise resolving on the verdict. */
function makeSession({ open = true } = {}) {
  const socket = new FakeSocket();
  const dg = new FakeDeepgram();
  const classifications = [];

  let resolveVerdict;
  const verdict = new Promise((resolve) => {
    resolveVerdict = resolve;
  });

  const engine = {
    bindStream: () => ({ id: 'leg_test' }),
    classify: async (ref, classification, meta) => {
      const record = { ref, classification, meta };
      classifications.push(record);
      resolveVerdict(record);
      return record;
    },
  };

  const session = new AmdStreamSession(socket, { engine, createDeepgram: () => dg });

  socket.push({
    event: 'start',
    start: { streamSid: 'MZ123', callSid: 'CA123', customParameters: { legId: 'leg_test' } },
  });
  if (open) dg.open();

  return { session, socket, dg, verdict, classifications };
}

/** One 20 ms μ-law frame, as Twilio sends it. */
const AUDIO_FRAME = { event: 'media', media: { payload: Buffer.alloc(160, 0xff).toString('base64') } };

describe('AmdStreamSession', () => {
  it('enters LISTENING and forwards audio to Deepgram without transcoding', () => {
    const { session, socket, dg } = makeSession();
    assert.equal(session.state, AmdState.LISTENING);

    socket.push(AUDIO_FRAME);
    assert.equal(dg.sent.length, 1);
    assert.equal(dg.sent[0].length, 160, 'frame should be forwarded byte-for-byte');
  });

  it('buffers audio that arrives before the Deepgram handshake completes', () => {
    const { socket, dg } = makeSession({ open: false });

    socket.push(AUDIO_FRAME);
    socket.push(AUDIO_FRAME);
    assert.equal(dg.sent.length, 0, 'nothing should be sent before Open');

    dg.open();
    assert.equal(dg.sent.length, 2, 'backlog should flush in order on Open');
  });

  it('classifies dead air as NO_ANSWER after the initial speech timeout', async () => {
    const { verdict } = makeSession();
    const result = await verdict;
    assert.equal(result.classification, 'NO_ANSWER');
    assert.match(result.meta.reason, /dead_air/);
  });

  it('classifies a short greeting as HUMAN', async () => {
    const { dg, verdict } = makeSession();
    dg.transcript('Hello?');
    const result = await verdict;
    assert.equal(result.classification, 'HUMAN');
    assert.ok(result.meta.latencyMs >= 0);
  });

  it('classifies a voicemail phrase as MACHINE', async () => {
    const { dg, verdict } = makeSession();
    dg.transcript("Hi, you've reached", { isFinal: true });
    const result = await verdict;
    assert.equal(result.classification, 'MACHINE');
    assert.match(result.meta.reason, /machine_phrase/);
  });

  it('classifies an unbroken speech block as MACHINE', async () => {
    const { dg, verdict } = makeSession();
    // Neutral words: no greeting match, no machine phrase — only the
    // continuous-speech timer can decide this one.
    dg.transcript('and then the technician');
    const result = await verdict;
    assert.equal(result.classification, 'MACHINE');
    assert.match(result.meta.reason, /continuous_speech/);
  });

  it('lets a human pause disarm the continuous-speech timer', async () => {
    const { dg, verdict } = makeSession();
    dg.transcript('and then the technician');
    // A pause arrives before the 90 ms speech-block timer fires.
    dg.emit(LiveTranscriptionEvents.UtteranceEnd);

    const result = await verdict;
    // With the speech-block timer disarmed the hard deadline decides instead.
    assert.match(result.meta.reason, /decision_deadline/);
  });

  it('decides once and ignores later transcripts', async () => {
    const { dg, verdict, classifications } = makeSession();
    dg.transcript('Hello?');
    await verdict;
    dg.transcript("You've reached voicemail", { isFinal: true });
    assert.equal(classifications.length, 1);
  });

  it('releases Deepgram but leaves the Twilio socket to the engine', async () => {
    const { socket, dg, verdict } = makeSession();
    dg.transcript('Hey');
    await verdict;
    assert.equal(dg.closed, true);
    // Closing this socket would advance the call past <Connect><Stream> and
    // hang up the very human we are about to bridge.
    assert.equal(socket.closed, false);
  });

  it('stops forwarding audio once a verdict is reached', async () => {
    const { socket, dg, verdict } = makeSession();
    dg.transcript('Hey');
    await verdict;
    const before = dg.sent.length;
    socket.push(AUDIO_FRAME);
    assert.equal(dg.sent.length, before, 'no frames after the decision');
  });

  it('aborts without classifying when the caller hangs up first', async () => {
    const { session, socket, classifications } = makeSession();
    socket.emit('close', 1000);
    assert.equal(session.state, AmdState.ABORTED);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(classifications.length, 0, 'a dead socket must not produce a disposition');
  });
});
