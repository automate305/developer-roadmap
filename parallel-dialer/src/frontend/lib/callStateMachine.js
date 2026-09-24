/**
 * The agent workstation's call/device lifecycle, as an explicit transition
 * table instead of `setStatus(...)` calls scattered across event handlers.
 *
 *   OFFLINE ──CONNECT──▶ CONNECTING ──REGISTERED──▶ READY ──INCOMING──▶ RINGING ──ACCEPTED──▶ IN_CALL
 *      ▲                                              ▲                                          │
 *      └───────────────── GO_OFFLINE ─────────────────┴──────────────── CALL_ENDED ───────────────┘
 *
 * DEVICE_ERROR and UNREGISTERED are reachable from any state (the Twilio
 * Voice SDK can report either at any time). ACCEPTED is legal from READY as
 * well as RINGING because auto-answer accepts the call before RINGING is
 * ever entered.
 *
 * Pure and framework-agnostic on purpose — no React import here. This models
 * one workstation reacting to its own SDK/UI events one at a time; it is not
 * the place for the engine's session/batch/leg state, which is driven by
 * concurrent, re-delivered Twilio webhooks and has its own invariants (see
 * AGENTS.md). Keep those separate.
 */

export const AgentStatus = Object.freeze({
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  READY: 'READY',
  RINGING: 'RINGING',
  IN_CALL: 'IN_CALL',
  ERROR: 'ERROR',
});

const ANY_STATE = Object.freeze(Object.values(AgentStatus));

/**
 * @typedef {{ from: readonly string[], to: string | ((from: string) => string) }} Rule
 * @type {Record<string, Rule>}
 */
const TRANSITIONS = {
  CONNECT: { from: [AgentStatus.OFFLINE, AgentStatus.ERROR], to: AgentStatus.CONNECTING },
  REGISTERED: { from: [AgentStatus.CONNECTING], to: AgentStatus.READY },
  UNREGISTERED: { from: ANY_STATE, to: AgentStatus.OFFLINE },
  DEVICE_ERROR: { from: ANY_STATE, to: AgentStatus.ERROR },
  INCOMING: { from: [AgentStatus.READY], to: AgentStatus.RINGING },
  ACCEPTED: { from: [AgentStatus.READY, AgentStatus.RINGING], to: AgentStatus.IN_CALL },
  // A call can end from RINGING (canceled/rejected before answer) or IN_CALL
  // (hangup either side). If the device is already in ERROR, stay there —
  // the call tearing down cleanly doesn't mean the device recovered.
  CALL_ENDED: {
    from: [AgentStatus.RINGING, AgentStatus.IN_CALL, AgentStatus.ERROR],
    to: (from) => (from === AgentStatus.ERROR ? AgentStatus.ERROR : AgentStatus.READY),
  },
  GO_OFFLINE: { from: ANY_STATE, to: AgentStatus.OFFLINE },
};

/**
 * Compute the next status for `event` fired while in `current`.
 * Returns `null` if the event isn't legal from `current` — callers decide
 * whether that's a silent no-op or worth a warning; it is never thrown from
 * here, since this runs inside Twilio Voice SDK event callbacks and a thrown
 * error there would break the SDK's own dispatch, not just this component.
 *
 * @param {string} current one of {@link AgentStatus}
 * @param {keyof typeof TRANSITIONS} event
 * @returns {string | null}
 */
export function transition(current, event) {
  const rule = TRANSITIONS[event];
  if (!rule) throw new Error(`Unknown call-status event: ${event}`);
  if (!rule.from.includes(current)) return null;
  return typeof rule.to === 'function' ? rule.to(current) : rule.to;
}
