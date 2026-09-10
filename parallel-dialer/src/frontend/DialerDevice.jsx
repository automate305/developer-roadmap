/**
 * DialerDevice.jsx — WebRTC agent workstation. Rendered as the Campaigns tab.
 *
 * Owns the Twilio Voice `Device` lifecycle and the agent's view of a dialing
 * session. `status` moves along the transition table in
 * ./lib/callStateMachine.js — see that file for the full state diagram and
 * legal transitions; this component only ever calls `dispatchStatus(event)`,
 * never `setStatus` directly.
 *
 * The connected lead always arrives as an *inbound* call to this browser: the
 * backend bridges the winning outbound leg with `<Dial><Client>`, so the agent
 * never dials — they answer. With auto-answer on, the call is accepted the
 * instant it arrives, which is what keeps the human on the other end from
 * hearing dead air after they say "hello".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Device } from '@twilio/voice-sdk';
import { AgentStatus, transition } from './lib/callStateMachine.js';

export { AgentStatus };

const STATUS_TONE = {
  [AgentStatus.OFFLINE]: 'neutral',
  [AgentStatus.CONNECTING]: 'pending',
  [AgentStatus.READY]: 'good',
  [AgentStatus.RINGING]: 'pending',
  [AgentStatus.IN_CALL]: 'live',
  [AgentStatus.ERROR]: 'bad',
};

const MAX_LOG_ENTRIES = 200;

/** Outcomes an agent can log by hand once a call ends. The dialer's own AMD
 * verdicts (HUMAN/MACHINE/NO_ANSWER/…) come from the engine, not this — this
 * is what the agent decided about a conversation that actually happened. */
const OUTCOMES = [
  { key: 'meeting', label: 'Meeting booked', tone: 'good' },
  { key: 'callback', label: 'Follow up' },
  { key: 'not_interested', label: 'Not interested' },
];

/**
 * @param {object} props
 * @param {string} [props.apiBase] backend origin; defaults to same-origin
 * @param {string} [props.identity] client identity, must match the backend's
 * @param {string} [props.apiKey] shared secret sent as `x-dialer-key`
 * @param {{ text: string, listName: string, token: number }} [props.loadRequest]
 *   set by the parent (e.g. "Start campaign" on the Lists tab) to replace the
 *   dial list; `token` must change on every request so the same list can be
 *   loaded twice in a row.
 * @param {(entry: { phone: string, disposition: string, at: number }) => void} [props.onLegEnded]
 *   fired for every leg the engine reports ended, win or lose — this is how
 *   Contacts learns a number's last outcome.
 * @param {(summary: object) => void} [props.onSessionEnded] fired once a
 *   session is stopped or exhausts its queue.
 */
export default function DialerDevice({
  apiBase = '',
  identity = 'agent_1',
  apiKey = '',
  loadRequest = null,
  onLegEnded,
  onSessionEnded,
}) {
  const [status, setStatus] = useState(AgentStatus.OFFLINE);
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [pendingCall, setPendingCall] = useState(null);
  const [callInfo, setCallInfo] = useState(null);
  const [lastEndedCall, setLastEndedCall] = useState(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [events, setEvents] = useState([]);

  const [leadsText, setLeadsText] = useState('');
  const [activeListName, setActiveListName] = useState(null);
  const [batchSize, setBatchSize] = useState(4);
  // 'power'  → one line, agent bridged on answer, no AMD verdict acted on.
  // 'parallel' → N lines, the AMD verdict picks who reaches the agent.
  const [mode, setMode] = useState('power');
  const screening = mode === 'parallel';
  const effectiveBatchSize = screening ? Number(batchSize) : 1;
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [meetingsBooked, setMeetingsBooked] = useState(0);
  const sessionMetaRef = useRef(null); // { startedAt, mode, listName, leadsTotal }

  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const callTimerRef = useRef(null);
  const callStartRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState('');
  // The AMD-phase snippet for whichever leg most recently won — captured off
  // the SSE feed below, snapshotted onto the call the moment it connects.
  // This is NOT a live conversation transcript: the Deepgram socket closes
  // the instant a verdict is reached (see AGENTS.md invariant 6), so nothing
  // is heard past that point. Best-effort under parallel dial, where more
  // than one leg can classify HUMAN in close succession — exact under power
  // dial, the one call at a time case this is mainly for.
  const preConnectTranscriptRef = useRef('');

  // A list handed over from the Lists tab replaces the dial list. `token`
  // changes on every request so re-sending the same list still applies.
  useEffect(() => {
    if (!loadRequest) return;
    setLeadsText(loadRequest.text);
    setActiveListName(loadRequest.listName);
  }, [loadRequest]);

  /** Auth headers for the control plane. */
  const authHeaders = useMemo(() => (apiKey ? { 'x-dialer-key': apiKey } : {}), [apiKey]);

  /** Append to the activity log, newest first, bounded. */
  const pushEvent = useCallback((level, message, detail) => {
    setEvents((prev) =>
      [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date(), level, message, detail }, ...prev].slice(
        0,
        MAX_LOG_ENTRIES,
      ),
    );
  }, []);

  /** Move `status` along the transition table in ./lib/callStateMachine.js.
   * Never throws from inside an SDK event handler: an event that isn't legal
   * from the current state is left alone (with a dev warning) rather than
   * guessed at. */
  const dispatchStatus = useCallback((event) => {
    setStatus((current) => {
      const next = transition(current, event);
      if (next === null) {
        console.warn(`[DialerDevice] ignored ${event} while ${current}`);
        return current;
      }
      return next;
    });
  }, []);

  const fetchToken = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/token?identity=${encodeURIComponent(identity)}`, {
      headers: authHeaders,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || `Token request failed (${response.status})`);
    }
    const { token } = await response.json();
    return token;
  }, [apiBase, identity, authHeaders]);

  // ───────────────────────────────────────────────────── call attachment ────

  /** Wire the per-call listeners that drive the UI while a lead is connected. */
  const attachCall = useCallback(
    (call) => {
      callRef.current = call;

      call.on('accept', () => {
        dispatchStatus('ACCEPTED');
        setPendingCall(null);
        setLastEndedCall(null);
        setNotes('');
        setMuted(call.isMuted());
        callStartRef.current = Date.now();
        setCallInfo({
          from: call.parameters?.From ?? 'unknown',
          callSid: call.parameters?.CallSid ?? null,
          startedAt: Date.now(),
          transcript: preConnectTranscriptRef.current,
        });
        preConnectTranscriptRef.current = '';
        setElapsed(0);
        callTimerRef.current = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
        pushEvent('success', 'Call connected', call.parameters?.From);
      });

      const teardown = (label) => {
        if (callTimerRef.current) {
          clearInterval(callTimerRef.current);
          callTimerRef.current = null;
        }
        const durationSeconds = callStartRef.current ? Math.round((Date.now() - callStartRef.current) / 1000) : 0;
        callStartRef.current = null;
        callRef.current = null;
        setPendingCall(null);
        setInputLevel(0);
        setOutputLevel(0);
        setMuted(false);
        dispatchStatus('CALL_ENDED');
        pushEvent('info', label);
        // A connected call is worth asking about; one that never connected
        // (canceled/rejected before answer) is not. This fires the same way
        // whether the agent hung up or the caller did — Twilio's `disconnect`
        // event doesn't distinguish, and neither does this.
        setCallInfo((info) => {
          if (info) setLastEndedCall({ from: info.from, endedAt: Date.now(), durationSeconds, transcript: info.transcript });
          return null;
        });
      };

      call.on('disconnect', () => teardown('Call ended'));
      call.on('cancel', () => teardown('Call canceled before answer'));
      call.on('reject', () => teardown('Call rejected'));

      call.on('error', (err) => {
        pushEvent('error', `Call error: ${err.message}`, err.code);
        teardown('Call ended after error');
      });

      // Live mic / speaker levels, ~50 Hz. Purely visual — cheap enough to
      // render because both values are clamped to one decimal place.
      call.on('volume', (input, output) => {
        setInputLevel(Math.round(input * 100) / 100);
        setOutputLevel(Math.round(output * 100) / 100);
      });
    },
    [pushEvent, dispatchStatus],
  );

  // ─────────────────────────────────────────────────── device lifecycle ────

  const goOnline = useCallback(async () => {
    if (deviceRef.current) return;

    setError(null);
    dispatchStatus('CONNECT');
    pushEvent('info', 'Requesting access token…');

    try {
      const token = await fetchToken();

      const device = new Device(token, {
        // Opus for the browser hop; pcmu keeps parity with the 8 kHz PSTN leg
        // when Opus is unavailable.
        codecPreferences: ['opus', 'pcmu'],
        // Pre-warming the media connection removes the ICE handshake from the
        // critical path when a lead is bridged in.
        maxCallSignalingTimeoutMs: 30000,
        enableImprovedSignalingErrorPrecision: true,
        logLevel: 'error',
      });

      device.on('registered', () => {
        dispatchStatus('REGISTERED');
        pushEvent('success', `Registered as ${identity}`);
      });

      device.on('unregistered', () => {
        dispatchStatus('UNREGISTERED');
        pushEvent('warn', 'Device unregistered');
      });

      device.on('error', (err) => {
        setError(err.message);
        dispatchStatus('DEVICE_ERROR');
        pushEvent('error', `Device error: ${err.message}`, err.code);
      });

      // Tokens are short-lived; refresh before expiry so an in-progress
      // conversation is never dropped by an auth failure.
      device.on('tokenWillExpire', async () => {
        try {
          const fresh = await fetchToken();
          device.updateToken(fresh);
          pushEvent('info', 'Access token refreshed');
        } catch (err) {
          pushEvent('error', `Token refresh failed: ${err.message}`);
        }
      });

      device.on('incoming', (call) => {
        pushEvent('info', `Incoming lead from ${call.parameters?.From ?? 'unknown'}`);
        attachCall(call);

        if (autoAnswerRef.current) {
          call.accept();
        } else {
          setPendingCall(call);
          dispatchStatus('INCOMING');
        }
      });

      deviceRef.current = device;
      await device.register();
    } catch (err) {
      setError(err.message);
      dispatchStatus('DEVICE_ERROR');
      pushEvent('error', `Failed to go online: ${err.message}`);
      deviceRef.current = null;
    }
  }, [fetchToken, attachCall, identity, pushEvent, dispatchStatus]);

  const goOffline = useCallback(() => {
    callRef.current?.disconnect();
    deviceRef.current?.destroy();
    deviceRef.current = null;
    callRef.current = null;
    dispatchStatus('GO_OFFLINE');
    setPendingCall(null);
    setCallInfo(null);
    pushEvent('info', 'Went offline');
  }, [pushEvent, dispatchStatus]);

  // The `incoming` listener closes over `autoAnswer`; a ref keeps it current
  // without tearing down and re-registering the Device on every toggle.
  const autoAnswerRef = useRef(autoAnswer);
  useEffect(() => {
    autoAnswerRef.current = autoAnswer;
  }, [autoAnswer]);

  // Destroy the Device on unmount so the browser releases the microphone.
  useEffect(
    () => () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
    },
    [],
  );

  // ───────────────────────────────────────────────────── call controls ────

  const acceptCall = useCallback(() => {
    pendingCall?.accept();
  }, [pendingCall]);

  const rejectCall = useCallback(() => {
    pendingCall?.reject();
    setPendingCall(null);
    dispatchStatus('CALL_ENDED');
  }, [pendingCall, dispatchStatus]);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !call.isMuted();
    call.mute(next);
    setMuted(next);
    pushEvent('info', next ? 'Microphone muted' : 'Microphone unmuted');
  }, [pushEvent]);

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    pushEvent('info', 'Hang up requested');
  }, [pushEvent]);

  const logOutcome = useCallback(
    (outcomeKey) => {
      const label = OUTCOMES.find((o) => o.key === outcomeKey)?.label ?? outcomeKey;
      const from = status === AgentStatus.IN_CALL ? callInfo?.from : lastEndedCall?.from;
      if (outcomeKey === 'meeting') setMeetingsBooked((n) => n + 1);
      pushEvent('success', `Logged: ${label}`, [from, notes].filter(Boolean).join(' — ') || undefined);
      // Logging mid-call records the outcome and clears the notes field for
      // whatever's said next; it does not end the call. Logging after
      // hangup dismisses the prompt too — there's nothing left to add to.
      if (status !== AgentStatus.IN_CALL) setLastEndedCall(null);
      setNotes('');
    },
    [pushEvent, status, callInfo, lastEndedCall, notes],
  );

  // ──────────────────────────────────────────────────── session control ────

  const finishSession = useCallback(
    (finalSnapshot) => {
      const meta = sessionMetaRef.current;
      if (meta && onSessionEnded) {
        onSessionEnded({
          id: `session-${meta.startedAt}`,
          startedAt: meta.startedAt,
          endedAt: Date.now(),
          mode,
          listName: meta.listName,
          leadsTotal: meta.leadsTotal,
          stats: finalSnapshot?.stats ?? session?.stats ?? {},
          meetingsBooked,
        });
      }
      sessionMetaRef.current = null;
      setSession(null);
      setMeetingsBooked(0);
    },
    [mode, meetingsBooked, onSessionEnded, session],
  );

  const startSession = useCallback(async () => {
    const leads = leadsText
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (leads.length === 0) {
      pushEvent('warn', 'Add at least one E.164 number before dialing');
      return;
    }

    setStarting(true);
    try {
      const response = await fetch(`${apiBase}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          agentIdentity: identity, leads, batchSize: effectiveBatchSize, screening,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || 'Failed to start session');

      sessionMetaRef.current = { startedAt: Date.now(), listName: activeListName, leadsTotal: leads.length };
      setMeetingsBooked(0);
      setSession(body);
      pushEvent(
        'success',
        screening
          ? `Dialing ${leads.length} leads, ${effectiveBatchSize} lines at a time`
          : `Power dialing ${leads.length} leads, one line at a time`,
      );
    } catch (err) {
      pushEvent('error', `Could not start dialing: ${err.message}`);
    } finally {
      setStarting(false);
    }
  }, [leadsText, effectiveBatchSize, screening, apiBase, authHeaders, identity, pushEvent, activeListName]);

  const stopSession = useCallback(async () => {
    if (!session?.sessionId) return;
    try {
      await fetch(`${apiBase}/api/sessions/${session.sessionId}`, { method: 'DELETE', headers: authHeaders });
      pushEvent('warn', 'Dialing session stopped');
      finishSession(session);
    } catch (err) {
      pushEvent('error', `Could not stop session: ${err.message}`);
    }
  }, [session, apiBase, authHeaders, pushEvent, finishSession]);

  // ─────────────────────────────────────────── backend activity feed (SSE) ────

  useEffect(() => {
    const url = new URL(`${apiBase || window.location.origin}/api/events`);
    if (apiKey) url.searchParams.set('key', apiKey);

    // EventSource cannot send headers, so the key rides in the query string.
    const source = new EventSource(url.toString());

    /** @type {[string, (payload: any) => string][]} */
    const handlers = [
      ['batch:started', (p) => `Batch dialing ${p.legs?.length ?? 0} lines`],
      ['leg:dialing', (p) => `Ringing ${p.phone}`],
      ['leg:streaming', (p) => `Listening to ${p.phone}`],
      ['leg:classified', (p) => `${p.phone} → ${p.classification}${p.won === false ? ' (lost race)' : ''}`],
      ['leg:connected', (p) => `Bridging ${p.phone} to you`],
      ['leg:ended', (p) => `${p.phone} ended: ${p.disposition ?? 'unknown'}`],
      ['batch:resolved', () => 'Batch resolved'],
      ['session:exhausted', () => 'Lead list exhausted'],
    ];

    const bound = handlers.map(([name, format]) => {
      const listener = (message) => {
        try {
          const payload = JSON.parse(message.data);
          const level = name === 'leg:connected' ? 'success' : name === 'leg:ended' ? 'muted' : 'info';
          pushEvent(level, format(payload), payload.transcript || undefined);
          if (name === 'leg:classified' && payload.classification === 'HUMAN' && payload.won !== false) {
            // Held until the matching call actually rings this browser (see
            // `call.on('accept')`), then cleared. Best-effort under parallel
            // dial — see the ref's own comment for why.
            preConnectTranscriptRef.current = payload.transcript ?? '';
          }
          if (name === 'leg:ended' && payload.phone && onLegEnded) {
            onLegEnded({ phone: payload.phone, disposition: payload.disposition ?? 'UNKNOWN', at: Date.now() });
          }
          if (payload.sessionId && name === 'session:exhausted') {
            finishSession(payload);
          }
        } catch {
          /* malformed frame — ignore */
        }
      };
      source.addEventListener(name, listener);
      return [name, listener];
    });

    source.onerror = () => {
      // EventSource reconnects on its own; only note a genuine close.
      if (source.readyState === EventSource.CLOSED) pushEvent('warn', 'Activity feed disconnected');
    };

    return () => {
      for (const [name, listener] of bound) source.removeEventListener(name, listener);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finishSession/onLegEnded intentionally not in the dep list: re-subscribing on every session start/stop would drop in-flight SSE frames.
  }, [apiBase, apiKey, pushEvent]);

  // ─────────────────────────────────────────────────────────────── render ────

  const online = status !== AgentStatus.OFFLINE && status !== AgentStatus.ERROR;
  const inCall = status === AgentStatus.IN_CALL;

  return (
    <div className="tab tab--campaigns">
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Device</h2>
          <span className={`badge badge--${STATUS_TONE[status]}`} role="status" aria-live="polite">
            <span className="badge__dot" aria-hidden="true" />
            {status}
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={goOnline} disabled={online}>
            Go online
          </button>
          <button type="button" className="btn" onClick={goOffline} disabled={!online}>
            Go offline
          </button>
          <label className="toggle">
            <input type="checkbox" checked={autoAnswer} onChange={(e) => setAutoAnswer(e.target.checked)} />
            Auto-answer connected leads
          </label>
        </div>
      </section>

      {pendingCall && (
        <section className="panel panel--ringing">
          <h2 className="panel__title">Incoming lead</h2>
          <p className="mono">{pendingCall.parameters?.From ?? 'unknown number'}</p>
          <div className="row">
            <button type="button" className="btn btn--go" onClick={acceptCall}>
              Answer
            </button>
            <button type="button" className="btn btn--danger" onClick={rejectCall}>
              Reject
            </button>
          </div>
        </section>
      )}

      {inCall && (
        <section className="panel panel--live">
          <h2 className="panel__title">On call</h2>
          <p className="mono outcome__number">{callInfo?.from ?? '—'}</p>

          <div className="meters">
            <Meter label="Mic" value={muted ? 0 : inputLevel} muted={muted} />
            <Meter label="Lead" value={outputLevel} />
          </div>

          <div className="row">
            <button type="button" className={`btn ${muted ? 'btn--warn' : ''}`} onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="btn btn--stop" onClick={hangUp}>
              End call
            </button>
          </div>
        </section>
      )}

      {!pendingCall && !inCall && (
        <section className="panel panel--idle">
          <h2 className="panel__title">Call</h2>
          <p className="idle__text">{online ? 'Nothing on the line. A connected lead lands here.' : 'Go online to take calls.'}</p>
        </section>
      )}

      {/* Visible for the life of a campaign, not just mid-call, so notes
          taken from the previous call stay reachable while the next one
          rings. Disposition can be logged mid-call as well as after —
          nothing about "the meeting's booked" requires hanging up first. */}
      {session && (
        <section className="panel panel--notes">
          <div className="panel__head">
            <h2 className="panel__title">Call notes</h2>
            {(inCall || lastEndedCall) && (
              <span className="mono notes__timer">
                {inCall ? formatDuration(elapsed) : formatDuration(lastEndedCall.durationSeconds ?? 0)}
              </span>
            )}
          </div>

          {inCall || lastEndedCall ? (
            <>
              <p className="mono outcome__number">{(inCall ? callInfo?.from : lastEndedCall?.from) ?? '—'}</p>
              <textarea
                className="textarea"
                rows={3}
                placeholder="What came up, next steps…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="row">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    className={`btn ${o.tone === 'good' ? 'btn--primary' : ''}`}
                    onClick={() => logOutcome(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
                {lastEndedCall && !inCall && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setLastEndedCall(null);
                      setNotes('');
                    }}
                  >
                    Skip
                  </button>
                )}
              </div>

              <div className="transcript">
                <p className="transcript__label">What we heard before connecting</p>
                {(inCall ? callInfo?.transcript : lastEndedCall?.transcript) ? (
                  <p className="transcript__text">{inCall ? callInfo.transcript : lastEndedCall.transcript}</p>
                ) : (
                  <p className="transcript__empty">
                    Nothing captured here. Live in-call transcription isn't wired up yet — this only ever shows the
                    snippet the classifier heard before the line connected.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="idle__text">Waiting for the next call…</p>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Dial list</h2>
          {activeListName && <span className="pill">{activeListName}</span>}
        </div>
        <textarea
          className="textarea mono"
          rows={5}
          placeholder={'+13055550123\n+17865550188\n+19545550142'}
          value={leadsText}
          onChange={(e) => {
            setLeadsText(e.target.value);
            setActiveListName(null);
          }}
          disabled={Boolean(session)}
        />
        <div className="modes" role="group" aria-label="Dialing mode">
          <button
            type="button"
            className={`mode ${mode === 'power' ? 'mode--on' : ''}`}
            aria-pressed={mode === 'power'}
            onClick={() => setMode('power')}
            disabled={Boolean(session)}
          >
            <span className="mode__name">Power dial</span>
            <span className="mode__note">One line. You hear every call.</span>
          </button>
          <button
            type="button"
            className={`mode ${mode === 'parallel' ? 'mode--on' : ''}`}
            aria-pressed={mode === 'parallel'}
            onClick={() => setMode('parallel')}
            disabled={Boolean(session)}
          >
            <span className="mode__name">Parallel dial</span>
            <span className="mode__note">Several lines. Voicemails screened out.</span>
          </button>
        </div>

        <div className="row">
          <label className="field">
            Lines per batch
            <input
              type="number"
              min={1}
              max={10}
              value={screening ? batchSize : 1}
              onChange={(e) => setBatchSize(e.target.value)}
              disabled={Boolean(session) || !screening}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            onClick={startSession}
            disabled={!online || starting || Boolean(session)}
          >
            {starting ? 'Starting…' : 'Start dialing'}
          </button>
          <button type="button" className="btn btn--danger" onClick={stopSession} disabled={!session}>
            Stop
          </button>
        </div>

        {session && (
          <dl className="facts facts--wide">
            <div>
              <dt>Remaining</dt>
              <dd className="mono">{session.remainingLeads}</dd>
            </div>
            <div>
              <dt>Humans</dt>
              <dd className="mono">{session.stats?.humans ?? 0}</dd>
            </div>
            <div>
              <dt>Machines</dt>
              <dd className="mono">{session.stats?.machines ?? 0}</dd>
            </div>
            <div>
              <dt>No answer</dt>
              <dd className="mono">{session.stats?.noAnswer ?? 0}</dd>
            </div>
            <div>
              <dt>Meetings</dt>
              <dd className="mono">{meetingsBooked}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Activity</h2>
          <button type="button" className="btn btn--ghost" onClick={() => setEvents([])}>
            Clear
          </button>
        </div>
        <ul className="log">
          {events.length === 0 && <li className="log__empty">Nothing yet.</li>}
          {events.map((entry) => (
            <li key={entry.id} className={`log__row log__row--${entry.level}`}>
              <time className="log__time mono">{entry.at.toLocaleTimeString()}</time>
              <span className="log__msg">{entry.message}</span>
              {entry.detail && <span className="log__detail mono">{entry.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Simple level meter for mic / far-end audio. */
function Meter({ label, value, muted = false }) {
  const percent = Math.min(100, Math.round(value * 100));
  return (
    <div className="meter">
      <span className="meter__label">{label}</span>
      <div className="meter__track" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`meter__fill ${muted ? 'meter__fill--muted' : ''}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function formatDuration(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
