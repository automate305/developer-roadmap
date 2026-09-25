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

const LEG_LIFECYCLE_EVENTS = new Set(['leg:dialing', 'leg:streaming', 'leg:classified', 'leg:connected', 'leg:ended']);

/** One line rack tile's label/tone for a leg snapshot off the SSE feed.
 * Mirrors dialerEngine.js's LegState/Disposition exactly — see that file if
 * a new value ever gets added on either enum. */
function legPhase(leg) {
  if (leg.state === 'ENDED') {
    switch (leg.disposition) {
      case 'HUMAN': return { label: 'Ended', tone: 'neutral' };
      case 'MACHINE': return { label: 'Voicemail', tone: 'pending' };
      case 'NO_ANSWER': return { label: 'No answer', tone: 'neutral' };
      case 'BUSY': return { label: 'Busy', tone: 'neutral' };
      case 'FAILED': return { label: 'Failed', tone: 'bad' };
      case 'ABANDONED': return { label: 'Lost race', tone: 'neutral' };
      case 'CANCELED': return { label: 'Canceled', tone: 'neutral' };
      default: return { label: 'Ended', tone: 'neutral' };
    }
  }
  switch (leg.state) {
    case 'QUEUED': return { label: 'Queued', tone: 'neutral' };
    case 'RINGING': return { label: 'Ringing', tone: 'pending' };
    case 'ANSWERED': return { label: 'Answered', tone: 'pending' };
    case 'CLASSIFYING': return { label: 'Listening…', tone: 'accent' };
    case 'CONNECTED': return { label: 'Connected', tone: 'live' };
    default: return { label: leg.state ?? 'Unknown', tone: 'neutral' };
  }
}

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
 * @param {{ text: string, listName: string, contacts?: object[], token: number }} [props.loadRequest]
 *   set by the parent (e.g. "Start campaign" on the Lists tab) to replace the
 *   dial list; `token` must change on every request so the same list can be
 *   loaded twice in a row. `contacts`, when present, are that list's full
 *   records — carried through to the dialer so a connected call can screen-pop
 *   the company/name instead of just a phone number.
 * @param {object[]} [props.contacts] every contact on file, across lists —
 *   the fallback screen-pop match for a freeform-pasted number that happens
 *   to already be a known contact.
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
  contacts = [],
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
  // The full contact records behind the active list, when it came from
  // "Start campaign" rather than a freeform paste — keyed for startSession
  // to attach contactId/name/company onto each lead below.
  const [activeListContacts, setActiveListContacts] = useState([]);
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
  // Every leg in the current batch, keyed by legId — replaced wholesale on
  // `batch:started`, upserted per leg on every lifecycle event after that.
  // This is what renders the line rack: real state off the same SSE feed
  // the Activity log already reads, not a mock. One leg in power-dial mode
  // (batchSize forced to 1), up to ten in parallel mode.
  const [batchLegs, setBatchLegs] = useState([]);

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
  // The winning leg's identity — outbound Twilio Call SID, the lead's own
  // phone number, and (when known) their name/company — captured at the
  // same `leg:classified` moment as the transcript above, for the same
  // best-effort-under-parallel-dial reason.
  //
  // `callSid` is NOT `call.parameters.CallSid`: that's the inbound
  // `<Dial><Client>` leg to this browser, a different call from the
  // backend's point of view, and it's the outbound leg's SID that
  // `logCallActivity` used when it created this call's HubSpot engagement —
  // so it's the only id `logOutcome` below can use to find that same
  // engagement again.
  //
  // `phone` is NOT `call.parameters.From` either: the bridge in
  // dialerEngine.js's `#connectToAgent` sets no `callerId` on `<Dial>`, so
  // Twilio's default applies and the inbound leg's From is the *parent*
  // call's From — this agency's own Twilio caller ID, not the lead's number.
  // The SSE feed is the only place the lead's actual number is available on
  // this side of the bridge.
  const connectedLegRef = useRef(null);

  // A list handed over from the Lists tab replaces the dial list. `token`
  // changes on every request so re-sending the same list still applies.
  useEffect(() => {
    if (!loadRequest) return;
    setLeadsText(loadRequest.text);
    setActiveListName(loadRequest.listName);
    setActiveListContacts(loadRequest.contacts ?? []);
  }, [loadRequest]);

  // phone (E.164) → contact record, for attaching name/company to a lead
  // before dialing and for screen-popping a connected call. The active
  // list's own records win; contacts on file elsewhere are the fallback for
  // a freeform-pasted number that happens to already be a known contact.
  const phoneToContact = useMemo(() => {
    const map = new Map();
    for (const c of contacts) if (c.phone1) map.set(c.phone1, c);
    for (const c of activeListContacts) if (c.phone1) map.set(c.phone1, c);
    return map;
  }, [contacts, activeListContacts]);

  // The SSE effect below closes over this once and never resubscribes (a
  // deliberate choice — see its own comment), so it reads through a ref
  // instead of the memo directly to stay current without dropping frames.
  const phoneToContactRef = useRef(phoneToContact);
  useEffect(() => {
    phoneToContactRef.current = phoneToContact;
  }, [phoneToContact]);

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
        const lead = connectedLegRef.current;
        setCallInfo({
          // The lead's actual number (see connectedLegRef's comment) —
          // call.parameters.From is this agency's own Twilio caller ID, not
          // the lead's, so it's only the fallback when the SSE feed missed it.
          from: lead?.phone || call.parameters?.From || 'unknown',
          name: lead?.name || null,
          company: lead?.company || null,
          // The outbound leg's SID (see connectedLegRef's comment) — what
          // logOutcome needs, not the browser leg's own CallSid.
          callSid: lead?.callSid ?? null,
          startedAt: Date.now(),
          transcript: preConnectTranscriptRef.current,
        });
        preConnectTranscriptRef.current = '';
        connectedLegRef.current = null;
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
          if (info) {
            setLastEndedCall({
              from: info.from,
              name: info.name,
              company: info.company,
              callSid: info.callSid,
              endedAt: Date.now(),
              durationSeconds,
              transcript: info.transcript,
            });
          }
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
      const inCall = status === AgentStatus.IN_CALL;
      const active = inCall ? callInfo : lastEndedCall;
      if (outcomeKey === 'meeting') setMeetingsBooked((n) => n + 1);
      pushEvent('success', `Logged: ${label}`, [active?.from, notes].filter(Boolean).join(' — ') || undefined);

      if (active?.callSid) {
        fetch(`${apiBase}/api/workspace/outcomes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ callSid: active.callSid, outcome: outcomeKey, notes }),
        })
          .then((response) => {
            if (!response.ok) throw new Error(`outcome request failed (${response.status})`);
          })
          .catch((err) => pushEvent('warn', 'Outcome not sent to HubSpot', err.message));
      } else {
        // No outbound-leg SID captured for this call — logOutcome shouldn't
        // block the agent on that, but say so rather than quietly acting as
        // if it reached the CRM when it never left the browser.
        pushEvent('warn', 'Outcome logged here only — no call SID to attach it to in HubSpot');
      }

      // Logging mid-call records the outcome and clears the notes field for
      // whatever's said next; it does not end the call. Logging after
      // hangup dismisses the prompt too — there's nothing left to add to.
      if (!inCall) setLastEndedCall(null);
      setNotes('');
    },
    [apiBase, authHeaders, pushEvent, status, callInfo, lastEndedCall, notes],
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
      setBatchLegs([]);
    },
    [mode, meetingsBooked, onSessionEnded, session],
  );

  const startSession = useCallback(async () => {
    const phones = leadsText
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    // Attach name/company when this number matches a known contact —
    // dialerEngine.js carries these through to every SSE event, which is
    // what powers the screen-pop below. Deliberately NOT contactId: our
    // local contact record's `id` is this workspace's own
    // `crypto.randomUUID()`, not a HubSpot object id, and
    // hubspotService.js#logCallActivity does `args.contactId ??
    // findContactIdByPhone(phone)` — a truthy-but-wrong id here would skip
    // that working phone lookup and send HubSpot a garbage association.
    const leads = phones.map((phone) => {
      const contact = phoneToContact.get(phone);
      if (!contact) return phone;
      return {
        phone,
        name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null,
        company: contact.company || null,
      };
    });

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
      setBatchLegs([]);
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
  }, [leadsText, phoneToContact, effectiveBatchSize, screening, apiBase, authHeaders, identity, pushEvent, activeListName]);

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
            // dial — see each ref's own comment for why.
            preConnectTranscriptRef.current = payload.transcript ?? '';
            // name/company normally arrive from the backend (threaded through
            // since startSession attached them) — the local lookup is only a
            // fallback for a session started before that leg carried them.
            const fallback = payload.phone ? phoneToContactRef.current.get(payload.phone) : null;
            connectedLegRef.current = {
              callSid: payload.callSid ?? null,
              phone: payload.phone ?? null,
              name: payload.name || (fallback ? [fallback.firstName, fallback.lastName].filter(Boolean).join(' ') : null) || null,
              company: payload.company || fallback?.company || null,
            };
          }
          if (name === 'leg:ended' && payload.phone && onLegEnded) {
            onLegEnded({ phone: payload.phone, disposition: payload.disposition ?? 'UNKNOWN', at: Date.now() });
          }
          if (payload.sessionId && name === 'session:exhausted') {
            finishSession(payload);
          }
          // The line rack: `batch:started` carries every leg for the new
          // batch (replacing whatever the last batch left on screen), and
          // every leg lifecycle event after that upserts just its own leg —
          // real state, not derived from the Activity log's text.
          if (name === 'batch:started') {
            setBatchLegs(payload.legs ?? []);
          } else if (LEG_LIFECYCLE_EVENTS.has(name) && payload.legId) {
            setBatchLegs((prev) => {
              const idx = prev.findIndex((leg) => leg.legId === payload.legId);
              if (idx === -1) return [...prev, payload];
              const next = [...prev];
              next[idx] = { ...next[idx], ...payload };
              return next;
            });
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

      {/* Promoted out of the Dial list panel so the numbers that matter mid-
          shift — how many are left, how many turned into a meeting — are
          visible without scrolling past whatever's on the line right now. */}
      {session && (
        <section className="panel panel--metrics">
          <h2 className="panel__title">Live metrics</h2>
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
            <div>
              <dt>Conversion</dt>
              <dd className="mono">
                {session.stats?.humans ? `${Math.round((meetingsBooked / session.stats.humans) * 100)}%` : '—'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* The line rack — one tile per leg in the current batch, real state
          off the same SSE feed the Activity log reads. One tile in
          power-dial mode (batchSize forced to 1), up to ten in parallel. */}
      {batchLegs.length > 0 && (
        <section className="panel panel--rack">
          <div className="panel__head">
            <h2 className="panel__title">Lines</h2>
            <span className="pill pill--muted">{batchLegs.length} in this batch</span>
          </div>
          <div className="line-rack">
            {batchLegs.map((leg) => {
              const phase = legPhase(leg);
              const label = leg.company || leg.name || leg.phone;
              return (
                <div key={leg.legId} className={`line-tile ${phase.tone === 'live' ? 'line-tile--connected' : ''}`}>
                  <p className="line-tile__label">{label}</p>
                  {label !== leg.phone && <p className="mono line-tile__phone">{leg.phone}</p>}
                  <span className={`badge badge--${phase.tone}`}>
                    <span className="badge__dot" aria-hidden="true" />
                    {phase.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
          <ProspectPop info={callInfo} />

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
              <ProspectPop info={inCall ? callInfo : lastEndedCall} />
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

/** The screen-pop: company/name when the number matches a known contact,
 * the bare phone number when it doesn't (a freeform-pasted lead, or one from
 * before this list was ever imported). */
function ProspectPop({ info }) {
  if (!info) return <p className="mono outcome__number">—</p>;
  if (!info.company && !info.name) {
    return <p className="mono outcome__number">{info.from ?? '—'}</p>;
  }
  return (
    <div className="prospect">
      {info.company && <p className="prospect__company">{info.company}</p>}
      <p className="prospect__meta">
        {info.name && <span className="prospect__name">{info.name}</span>}
        <span className="mono prospect__phone">{info.from ?? '—'}</span>
      </p>
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
