/**
 * dialerEngine.js — parallel call batch executor and status manager.
 *
 * ── How a batch runs ─────────────────────────────────────────────────────────
 *  1. `startSession()` takes an agent identity and a lead queue.
 *  2. Each batch fires N (3–5) simultaneous outbound calls via the Twilio REST
 *     API. Every leg answers into `<Connect><Stream>`, forking its inbound
 *     audio to `/media-stream` where the AMD state machine listens.
 *  3. The first leg classified HUMAN wins the race. Winning is a synchronous
 *     check-and-set (`#claimWinner`) executed before any `await`, so exactly
 *     one leg can win even when two classifications land in the same tick.
 *  4. The winner is redirected to `<Dial><Client>agent_x</Client></Dial>`;
 *     every other live leg in the batch is torn down immediately.
 *  5. When the batch resolves with no human, the next batch is dialed from the
 *     remaining queue until leads are exhausted or the session is stopped.
 *
 * ── Abandoned-call handling ──────────────────────────────────────────────────
 * A losing leg that was itself classified HUMAN is an abandoned call under
 * TCPA/FCC rules. Those legs are redirected to a spoken identification message
 * rather than dropped silently, and counted so the abandonment rate stays
 * auditable against the 3% safe harbour.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getTwilioClient, hangupCall, redirectCall } from './twilioClient.js';

const log = logger.child({ module: 'dialerEngine' });

/** Lifecycle of a single outbound leg. */
export const LegState = Object.freeze({
  QUEUED: 'QUEUED',
  RINGING: 'RINGING',
  ANSWERED: 'ANSWERED',
  CLASSIFYING: 'CLASSIFYING',
  CONNECTED: 'CONNECTED',
  ENDED: 'ENDED',
});

/** Terminal disposition written to the CRM. */
export const Disposition = Object.freeze({
  HUMAN: 'HUMAN',
  MACHINE: 'MACHINE',
  NO_ANSWER: 'NO_ANSWER',
  BUSY: 'BUSY',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  ABANDONED: 'ABANDONED',
});

export const BatchState = Object.freeze({
  DIALING: 'DIALING',
  CONNECTED: 'CONNECTED',
  RESOLVED: 'RESOLVED',
});

export const SessionState = Object.freeze({
  IDLE: 'IDLE',
  DIALING: 'DIALING',
  IN_CALL: 'IN_CALL',
  STOPPED: 'STOPPED',
});

/** Twilio call statuses that mean the leg will never connect. */
const FAILED_STATUSES = new Set(['busy', 'failed', 'no-answer', 'canceled']);

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Normalise a lead into `{ phone, contactId, name, company }`.
 * Accepts a bare E.164 string or an object.
 * @param {string | Record<string, unknown>} input
 */
export function normalizeLead(input) {
  const raw = typeof input === 'string' ? { phone: input } : { ...input };
  const phone = String(raw.phone ?? raw.number ?? raw.to ?? '').trim();
  if (!E164.test(phone)) {
    throw new Error(`Lead phone must be E.164 (e.g. +13055550123), got "${phone}"`);
  }
  return {
    phone,
    contactId: raw.contactId ? String(raw.contactId) : null,
    name: raw.name ? String(raw.name) : null,
    company: raw.company ? String(raw.company) : null,
  };
}

export class DialerEngine extends EventEmitter {
  /** @type {Map<string, object>} sessionId → session */
  #sessions = new Map();
  /** @type {Map<string, object>} batchId → batch */
  #batches = new Map();
  /** @type {Map<string, { sessionId: string, batchId: string, legId: string }>} */
  #callIndex = new Map();
  /** @type {Map<string, string>} legId → callSid, for legs whose SID is pending */
  #legIndex = new Map();

  /**
   * @param {object} [deps] injection seams for tests
   * @param {(sid: string, opts?: object) => Promise<boolean>} [deps.hangupCall]
   * @param {(sid: string, twiml: string) => Promise<unknown>} [deps.redirectCall]
   * @param {() => import('twilio').Twilio} [deps.getClient]
   */
  constructor(deps = {}) {
    super();
    this.hangupCall = deps.hangupCall ?? hangupCall;
    this.redirectCall = deps.redirectCall ?? redirectCall;
    this.getClient = deps.getClient ?? getTwilioClient;
    this.setMaxListeners(0);
  }

  // ───────────────────────────────────────────────────────────── sessions ────

  /**
   * Open a dialing session for one agent and immediately dial the first batch.
   *
   * @param {object} opts
   * @param {string} [opts.agentIdentity] Twilio client identity to bridge onto
   * @param {Array<string|object>} opts.leads
   * @param {number} [opts.batchSize] lines per batch (clamped to 1–10)
   * @param {boolean} [opts.autoAdvance] dial the next batch when one resolves
   * @param {boolean} [opts.screening] when false, run as a power dialer: bridge
   *   the agent the moment the callee answers and never act on an AMD verdict.
   *   The classifier still runs and still records, so the agent's own
   *   disposition becomes ground truth for `scripts/score-amd.mjs`.
   * @returns {Promise<object>} session snapshot
   */
  async startSession({ agentIdentity, leads, batchSize, autoAdvance = true, screening = config.dialer.screening }) {
    const identity = agentIdentity || config.dialer.agentIdentity;
    const normalized = (leads ?? []).map(normalizeLead);
    if (normalized.length === 0) throw new Error('startSession requires at least one lead');

    let size = Math.min(Math.max(batchSize ?? config.dialer.batchSize, 1), 10);

    // Power-dial mode is one line by definition, and the clamp is a safety
    // interlock rather than tidiness. With screening off, the abandoned-call
    // path in classify() never runs — so a second human answering a parallel
    // batch would be torn down silently, with no identification message. That
    // is precisely the abandoned call the FCC requires us to announce. One
    // line leaves no losing leg, so the situation cannot arise.
    if (screening === false && size > 1) {
      log.warn('power-dial mode forces batchSize 1', { requested: size, screening });
      size = 1;
    }

    const session = {
      id: `sess_${randomUUID()}`,
      agentIdentity: identity,
      state: SessionState.DIALING,
      batchSize: size,
      screening,
      autoAdvance,
      queue: normalized,
      batchIds: [],
      startedAt: Date.now(),
      endedAt: null,
      stats: { dialed: 0, humans: 0, machines: 0, noAnswer: 0, failed: 0, abandoned: 0 },
    };

    this.#sessions.set(session.id, session);
    this.emit('session:started', this.snapshotSession(session.id));
    log.info('session started', { sessionId: session.id, agentIdentity: identity, leads: normalized.length, batchSize: size, screening });

    await this.#dialNextBatch(session);
    return this.snapshotSession(session.id);
  }

  /**
   * Stop a session and tear down every live leg it owns.
   * @param {string} sessionId
   * @param {string} [reason]
   */
  async stopSession(sessionId, reason = 'stopped_by_agent') {
    const session = this.#sessions.get(sessionId);
    if (!session) return null;

    session.state = SessionState.STOPPED;
    session.endedAt = Date.now();
    session.queue = [];

    for (const batchId of session.batchIds) {
      const batch = this.#batches.get(batchId);
      if (batch && batch.state !== BatchState.RESOLVED) {
        await this.#tearDownBatch(batch, { except: null, reason });
        batch.state = BatchState.RESOLVED;
      }
    }

    this.emit('session:stopped', { ...this.snapshotSession(sessionId), reason });
    log.info('session stopped', { sessionId, reason });
    return this.snapshotSession(sessionId);
  }

  // ─────────────────────────────────────────────────────────────── batches ────

  /**
   * Slice the next N leads off the queue and fire them in parallel.
   * @param {object} session
   */
  async #dialNextBatch(session) {
    if (session.state === SessionState.STOPPED) return null;

    const leads = session.queue.splice(0, session.batchSize);
    if (leads.length === 0) {
      session.state = SessionState.IDLE;
      session.endedAt = Date.now();
      this.emit('session:exhausted', this.snapshotSession(session.id));
      log.info('session queue exhausted', { sessionId: session.id, stats: session.stats });
      return null;
    }

    const batch = {
      id: `batch_${randomUUID()}`,
      sessionId: session.id,
      agentIdentity: session.agentIdentity,
      state: BatchState.DIALING,
      winnerLegId: null,
      startedAt: Date.now(),
      resolvedAt: null,
      legs: new Map(),
    };

    this.#batches.set(batch.id, batch);
    session.batchIds.push(batch.id);
    session.state = SessionState.DIALING;

    // Register every leg *before* any network call so a status callback that
    // races ahead of the create() response still finds its leg.
    for (const lead of leads) {
      const legId = `leg_${randomUUID()}`;
      batch.legs.set(legId, {
        id: legId,
        batchId: batch.id,
        sessionId: session.id,
        // Carried per-leg so CRM logging attributes the call to the agent who
        // actually took it, not to whichever identity the process defaults to.
        agentIdentity: batch.agentIdentity,
        lead,
        callSid: null,
        state: LegState.QUEUED,
        disposition: null,
        transcript: '',
        classifiedAt: null,
        answeredAt: null,
        endedAt: null,
        durationSeconds: 0,
        error: null,
      });
    }

    this.emit('batch:started', this.snapshotBatch(batch.id));
    log.info('batch dialing', { batchId: batch.id, sessionId: session.id, lines: leads.length });

    // Fire every leg concurrently; one bad number must not stall the others.
    await Promise.allSettled([...batch.legs.values()].map((leg) => this.#placeCall(batch, leg)));

    session.stats.dialed += leads.length;

    // Every leg failed at create() time — nothing will ever call back, so
    // resolve the batch here rather than waiting on a status webhook.
    const anyLive = [...batch.legs.values()].some((leg) => leg.state !== LegState.ENDED);
    if (!anyLive) await this.#maybeResolveBatch(batch);

    return this.snapshotBatch(batch.id);
  }

  /**
   * Create one outbound call whose answer TwiML opens a Media Stream.
   * @param {object} batch @param {object} leg
   */
  async #placeCall(batch, leg) {
    const rest = this.getClient();
    const params = new URLSearchParams({ legId: leg.id, batchId: batch.id });

    try {
      const call = await rest.calls.create({
        to: leg.lead.phone,
        from: config.twilio.callerId,
        url: `${config.publicBaseUrl}/twiml/outbound?${params.toString()}`,
        method: 'POST',
        timeout: config.dialer.ringTimeoutSeconds,
        // Twilio's own AMD is deliberately not used: it adds seconds of
        // latency. Classification happens in streamHandler.js instead.
        machineDetection: undefined,
        statusCallback: `${config.publicBaseUrl}/twiml/status?${params.toString()}`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });

      leg.callSid = call.sid;
      leg.state = LegState.RINGING;
      this.#callIndex.set(call.sid, { sessionId: batch.sessionId, batchId: batch.id, legId: leg.id });
      this.#legIndex.set(leg.id, call.sid);

      this.emit('leg:dialing', this.snapshotLeg(leg));
      log.debug('leg dialing', { batchId: batch.id, legId: leg.id, callSid: call.sid, to: leg.lead.phone });
    } catch (err) {
      leg.state = LegState.ENDED;
      leg.disposition = Disposition.FAILED;
      leg.endedAt = Date.now();
      leg.error = err?.message ?? String(err);
      this.emit('leg:ended', this.snapshotLeg(leg));
      log.warn('leg failed to dial', { batchId: batch.id, legId: leg.id, to: leg.lead.phone, err });
    }
  }

  // ──────────────────────────────────────────────────────── stream binding ────

  /**
   * Called by streamHandler when Twilio opens the Media Stream for a leg.
   * Resolves the leg from its custom `<Parameter>` payload or the call SID.
   *
   * @param {{ legId?: string, callSid?: string, streamSid?: string }} ref
   * @returns {object|null} the internal leg record (not a snapshot)
   */
  bindStream({ legId, callSid, streamSid }) {
    const leg = this.#findLeg({ legId, callSid });
    if (!leg) {
      log.warn('stream bound to unknown leg', { legId, callSid, streamSid });
      return null;
    }

    // The status webhook and the media stream race; whichever lands first
    // fills in the call SID.
    if (callSid && !leg.callSid) {
      leg.callSid = callSid;
      this.#callIndex.set(callSid, { sessionId: leg.sessionId, batchId: leg.batchId, legId: leg.id });
      this.#legIndex.set(leg.id, callSid);
    }

    if (leg.state === LegState.QUEUED || leg.state === LegState.RINGING) {
      leg.state = LegState.CLASSIFYING;
      leg.answeredAt = leg.answeredAt ?? Date.now();
    }

    leg.streamSid = streamSid ?? null;
    this.emit('leg:streaming', this.snapshotLeg(leg));
    return leg;
  }

  /**
   * AMD verdict for a leg. HUMAN triggers the winner race; anything else
   * tears the leg down and may resolve the batch.
   *
   * @param {{ legId?: string, callSid?: string }} ref
   * @param {'HUMAN'|'MACHINE'|'NO_ANSWER'} classification
   * @param {{ transcript?: string, latencyMs?: number, reason?: string }} [meta]
   */
  async classify(ref, classification, meta = {}) {
    const leg = this.#findLeg(ref);
    if (!leg) {
      log.warn('classification for unknown leg', { ...ref, classification });
      return null;
    }
    // A leg only gets classified once; late Deepgram events are ignored.
    if (leg.classifiedAt) return this.snapshotLeg(leg);

    leg.classifiedAt = Date.now();
    leg.transcript = meta.transcript ?? leg.transcript;
    leg.classificationLatencyMs = meta.latencyMs ?? null;
    leg.classificationReason = meta.reason ?? null;

    const batch = this.#batches.get(leg.batchId);
    const session = this.#sessions.get(leg.sessionId);

    log.info('leg classified', {
      batchId: leg.batchId,
      legId: leg.id,
      callSid: leg.callSid,
      classification,
      latencyMs: meta.latencyMs,
      reason: meta.reason,
    });

    // Power-dial mode: the agent is already on the call (or about to be), so
    // the verdict is recorded for scoring and nothing else. Acting on it here
    // would hang up on a live human whenever the classifier is wrong — the
    // failure the audit log exists to make visible, and the one an operator
    // never sees.
    if (session && session.screening === false) {
      this.emit('leg:classified', { ...this.snapshotLeg(leg), classification, acted: false });
      return this.snapshotLeg(leg);
    }

    if (classification !== 'HUMAN') {
      leg.disposition = classification === 'MACHINE' ? Disposition.MACHINE : Disposition.NO_ANSWER;
      if (session) {
        if (leg.disposition === Disposition.MACHINE) session.stats.machines += 1;
        else session.stats.noAnswer += 1;
      }
      this.emit('leg:classified', { ...this.snapshotLeg(leg), classification });
      await this.#endLeg(leg, { reason: `classified_${classification.toLowerCase()}` });
      if (batch) await this.#maybeResolveBatch(batch);
      return this.snapshotLeg(leg);
    }

    // ── HUMAN ──────────────────────────────────────────────────────────────
    // Synchronous check-and-set: no `await` between the read and the write, so
    // two simultaneous humans cannot both win the same batch.
    const won = batch ? this.#claimWinner(batch, leg.id) : false;
    this.emit('leg:classified', { ...this.snapshotLeg(leg), classification: 'HUMAN', won });

    if (!won) {
      // A real person answered a line we can no longer service. Play the
      // required identification message instead of hanging up on them.
      leg.disposition = Disposition.ABANDONED;
      if (session) session.stats.abandoned += 1;
      log.warn('abandoned call — human answered a losing leg', { batchId: leg.batchId, legId: leg.id, callSid: leg.callSid });
      await this.#abandonLeg(leg);
      if (batch) await this.#maybeResolveBatch(batch);
      return this.snapshotLeg(leg);
    }

    leg.disposition = Disposition.HUMAN;
    if (session) {
      session.stats.humans += 1;
      session.state = SessionState.IN_CALL;
    }
    await this.#connectToAgent(batch, leg);
    return this.snapshotLeg(leg);
  }

  /**
   * Atomically claim the batch for one leg.
   * Synchronous by construction — do not add `await` to this method.
   * @returns {boolean} true if this leg is the winner
   */
  #claimWinner(batch, legId) {
    if (batch.winnerLegId !== null) return batch.winnerLegId === legId;
    if (batch.state === BatchState.RESOLVED) return false;
    batch.winnerLegId = legId;
    batch.state = BatchState.CONNECTED;
    return true;
  }

  /**
   * Bridge the winning leg onto the agent's WebRTC client and drop the rest.
   */
  async #connectToAgent(batch, leg) {
    const identity = batch.agentIdentity;
    const twiml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response>' +
      // answerOnBridge keeps the lead hearing ringback (not silence) until the
      // agent's browser actually picks up.
      `<Dial answerOnBridge="true" timeLimit="14400" action="${config.publicBaseUrl}/twiml/bridge-status?legId=${leg.id}" method="POST">` +
      `<Client>${escapeXml(identity)}</Client>` +
      '</Dial>' +
      '</Response>';

    // Cancel the losers first, then bridge. Ordering matters: every extra
    // millisecond a losing leg stays up is another millisecond a second human
    // can pick up and be abandoned.
    const teardown = this.#tearDownBatch(batch, { except: leg.id, reason: 'human_connected_elsewhere' });

    try {
      await this.redirectCall(leg.callSid, twiml);
      leg.state = LegState.CONNECTED;
      leg.connectedAt = Date.now();
      this.emit('leg:connected', this.snapshotLeg(leg));
      this.emit('batch:connected', this.snapshotBatch(batch.id));
      log.info('leg bridged to agent', {
        batchId: batch.id,
        legId: leg.id,
        callSid: leg.callSid,
        agentIdentity: identity,
        timeToConnectMs: leg.connectedAt - batch.startedAt,
      });
    } catch (err) {
      // The lead hung up in the window between classification and redirect.
      leg.error = err?.message ?? String(err);
      log.warn('failed to bridge winning leg', { batchId: batch.id, legId: leg.id, err });
      batch.winnerLegId = null;
      batch.state = BatchState.DIALING;
      await this.#endLeg(leg, { reason: 'bridge_failed' });
    }

    await teardown;
    await this.#maybeResolveBatch(batch);
  }

  /**
   * Hang up every live leg in a batch except `except`.
   * @param {object} batch
   * @param {{ except: string|null, reason: string }} opts
   */
  async #tearDownBatch(batch, { except, reason }) {
    const victims = [...batch.legs.values()].filter(
      (leg) => leg.id !== except && leg.state !== LegState.ENDED && leg.callSid,
    );
    if (victims.length === 0) return;

    log.debug('tearing down losing legs', { batchId: batch.id, count: victims.length, reason });
    await Promise.allSettled(victims.map((leg) => this.#endLeg(leg, { reason })));
  }

  /**
   * Terminate one leg via the REST API and mark it ended.
   */
  async #endLeg(leg, { reason }) {
    if (leg.state === LegState.ENDED) return;
    leg.state = LegState.ENDED;
    leg.endedAt = Date.now();
    if (!leg.disposition) leg.disposition = Disposition.CANCELED;
    if (leg.answeredAt) leg.durationSeconds = Math.max(0, Math.round((leg.endedAt - leg.answeredAt) / 1000));

    this.emit('leg:ended', { ...this.snapshotLeg(leg), reason });

    if (!leg.callSid) return;
    try {
      await this.hangupCall(leg.callSid, { reason });
    } catch (err) {
      log.warn('hangup failed', { legId: leg.id, callSid: leg.callSid, err });
    }
  }

  /**
   * Losing leg with a live human on it: identify the caller, then release.
   * Required by TCPA §64.1200(a)(7) for abandoned calls.
   */
  async #abandonLeg(leg) {
    const twiml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response>' +
      '<Say voice="Polly.Joanna">Sorry for the interruption. This call was placed by our sales team. ' +
      'No agent is available right now. We will try you again shortly. Goodbye.</Say>' +
      '<Hangup/>' +
      '</Response>';
    try {
      await this.redirectCall(leg.callSid, twiml);
      leg.state = LegState.ENDED;
      leg.endedAt = Date.now();
      if (leg.answeredAt) leg.durationSeconds = Math.max(0, Math.round((leg.endedAt - leg.answeredAt) / 1000));
      this.emit('leg:ended', { ...this.snapshotLeg(leg), reason: 'abandoned' });
    } catch (err) {
      log.warn('abandon message failed, hanging up', { legId: leg.id, err });
      await this.#endLeg(leg, { reason: 'abandoned' });
    }
  }

  /**
   * Resolve a batch once no leg can still connect, then advance the session.
   */
  async #maybeResolveBatch(batch) {
    if (batch.state === BatchState.RESOLVED) return;

    const legs = [...batch.legs.values()];
    const live = legs.filter((leg) => leg.state !== LegState.ENDED);
    // A connected leg keeps the batch open until the agent hangs up.
    if (live.some((leg) => leg.state === LegState.CONNECTED)) return;
    if (live.length > 0) return;

    batch.state = BatchState.RESOLVED;
    batch.resolvedAt = Date.now();
    this.emit('batch:resolved', this.snapshotBatch(batch.id));
    log.info('batch resolved', {
      batchId: batch.id,
      durationMs: batch.resolvedAt - batch.startedAt,
      connected: Boolean(batch.winnerLegId),
    });

    const session = this.#sessions.get(batch.sessionId);
    if (!session || session.state === SessionState.STOPPED || !session.autoAdvance) return;

    // Dial the next batch on a fresh tick so listeners see `batch:resolved`
    // before `batch:started` for the successor.
    setImmediate(() => {
      this.#dialNextBatch(session).catch((err) => {
        log.error('failed to advance to next batch', { sessionId: session.id, err });
        this.emit('session:error', { sessionId: session.id, message: err?.message ?? String(err) });
      });
    });
  }

  // ─────────────────────────────────────────────────── Twilio status hooks ────

  /**
   * Handle a Twilio call status webhook.
   * @param {Record<string, string>} payload the POSTed form body
   */
  async handleStatusCallback(payload) {
    const { CallSid, CallStatus, CallDuration } = payload;
    const leg = this.#findLeg({ legId: payload.legId, callSid: CallSid });
    if (!leg) return null;

    if (CallSid && !leg.callSid) {
      leg.callSid = CallSid;
      this.#callIndex.set(CallSid, { sessionId: leg.sessionId, batchId: leg.batchId, legId: leg.id });
      this.#legIndex.set(leg.id, CallSid);
    }

    switch (CallStatus) {
      case 'ringing':
        if (leg.state === LegState.QUEUED) leg.state = LegState.RINGING;
        break;

      case 'in-progress': {
        leg.answeredAt = leg.answeredAt ?? Date.now();
        if (leg.state === LegState.RINGING || leg.state === LegState.QUEUED) leg.state = LegState.ANSWERED;

        // Power-dial mode bridges on answer rather than on a verdict. Guard on
        // `connectedAt` as well as the winner claim: Twilio re-delivers status
        // callbacks, and `#claimWinner` returns true again for a leg that has
        // already won.
        const answeredSession = this.#sessions.get(leg.sessionId);
        if (answeredSession && answeredSession.screening === false && !leg.connectedAt) {
          const answeredBatch = this.#batches.get(leg.batchId);
          if (answeredBatch && this.#claimWinner(answeredBatch, leg.id)) {
            leg.disposition = Disposition.HUMAN;
            answeredSession.stats.humans += 1;
            answeredSession.state = SessionState.IN_CALL;
            await this.#connectToAgent(answeredBatch, leg);
          }
        }
        break;
      }

      case 'completed':
      case 'busy':
      case 'failed':
      case 'no-answer':
      case 'canceled': {
        if (CallDuration) leg.durationSeconds = Number.parseInt(CallDuration, 10) || leg.durationSeconds;
        if (!leg.disposition) {
          // `completed` with no verdict means the callee answered and hung up
          // mid-classification — treat it as canceled, not failed.
          leg.disposition = CallStatus === 'busy' ? Disposition.BUSY
            : CallStatus === 'no-answer' ? Disposition.NO_ANSWER
            : CallStatus === 'failed' ? Disposition.FAILED
            : Disposition.CANCELED;
          const session = this.#sessions.get(leg.sessionId);
          if (session && FAILED_STATUSES.has(CallStatus)) {
            if (leg.disposition === Disposition.NO_ANSWER) session.stats.noAnswer += 1;
            else if (leg.disposition === Disposition.FAILED || leg.disposition === Disposition.BUSY) {
              session.stats.failed += 1;
            }
          }
        }
        // The call is already gone; mark it ended without a REST round trip.
        if (leg.state !== LegState.ENDED) {
          leg.state = LegState.ENDED;
          leg.endedAt = Date.now();
          this.emit('leg:ended', { ...this.snapshotLeg(leg), reason: `twilio_${CallStatus}` });
        }
        break;
      }

      default:
        break;
    }

    this.emit('leg:status', { ...this.snapshotLeg(leg), twilioStatus: CallStatus });

    const batch = this.#batches.get(leg.batchId);
    if (batch) await this.#maybeResolveBatch(batch);

    const session = this.#sessions.get(leg.sessionId);
    if (session && session.state === SessionState.IN_CALL && batch?.winnerLegId === leg.id) {
      session.state = session.queue.length > 0 ? SessionState.DIALING : SessionState.IDLE;
    }

    return this.snapshotLeg(leg);
  }

  // ────────────────────────────────────────────────────────────── lookups ────

  #findLeg({ legId, callSid }) {
    if (legId) {
      for (const batch of this.#batches.values()) {
        const leg = batch.legs.get(legId);
        if (leg) return leg;
      }
    }
    if (callSid) {
      const ref = this.#callIndex.get(callSid);
      if (ref) return this.#batches.get(ref.batchId)?.legs.get(ref.legId) ?? null;
    }
    return null;
  }

  /** @param {string} legId */
  getLeg(legId) {
    const leg = this.#findLeg({ legId });
    return leg ? this.snapshotLeg(leg) : null;
  }

  /** @param {string} callSid */
  getLegByCallSid(callSid) {
    const leg = this.#findLeg({ callSid });
    return leg ? this.snapshotLeg(leg) : null;
  }

  snapshotLeg(leg) {
    return {
      legId: leg.id,
      batchId: leg.batchId,
      sessionId: leg.sessionId,
      agentIdentity: leg.agentIdentity ?? null,
      callSid: leg.callSid,
      phone: leg.lead.phone,
      contactId: leg.lead.contactId,
      name: leg.lead.name,
      company: leg.lead.company,
      state: leg.state,
      disposition: leg.disposition,
      transcript: leg.transcript,
      durationSeconds: leg.durationSeconds,
      classificationLatencyMs: leg.classificationLatencyMs ?? null,
      classificationReason: leg.classificationReason ?? null,
      answeredAt: leg.answeredAt,
      endedAt: leg.endedAt,
      error: leg.error,
    };
  }

  snapshotBatch(batchId) {
    const batch = this.#batches.get(batchId);
    if (!batch) return null;
    return {
      batchId: batch.id,
      sessionId: batch.sessionId,
      agentIdentity: batch.agentIdentity,
      state: batch.state,
      winnerLegId: batch.winnerLegId,
      startedAt: batch.startedAt,
      resolvedAt: batch.resolvedAt,
      legs: [...batch.legs.values()].map((leg) => this.snapshotLeg(leg)),
    };
  }

  snapshotSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return null;
    return {
      sessionId: session.id,
      agentIdentity: session.agentIdentity,
      state: session.state,
      batchSize: session.batchSize,
      screening: session.screening,
      remainingLeads: session.queue.length,
      stats: { ...session.stats },
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      currentBatch: session.batchIds.length
        ? this.snapshotBatch(session.batchIds[session.batchIds.length - 1])
        : null,
    };
  }

  listSessions() {
    return [...this.#sessions.keys()].map((id) => this.snapshotSession(id));
  }

  /** Drop finished sessions and their call-SID index entries. */
  pruneResolved(maxAgeMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, batch] of this.#batches) {
      if (batch.state !== BatchState.RESOLVED || (batch.resolvedAt ?? 0) > cutoff) continue;
      for (const leg of batch.legs.values()) {
        if (leg.callSid) this.#callIndex.delete(leg.callSid);
        this.#legIndex.delete(leg.id);
      }
      this.#batches.delete(id);
    }
    for (const [id, session] of this.#sessions) {
      const done = session.state === SessionState.STOPPED || session.state === SessionState.IDLE;
      if (done && (session.endedAt ?? Date.now()) < cutoff) this.#sessions.delete(id);
    }
  }
}

/** Minimal XML escaping for values interpolated into TwiML. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Process-wide singleton used by the routes and the stream handler. */
export const dialerEngine = new DialerEngine();

export default dialerEngine;
