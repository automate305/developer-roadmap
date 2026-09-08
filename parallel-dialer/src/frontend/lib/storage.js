/**
 * localStorage helpers for state that has no backend home yet (contacts,
 * lists, session history — see AGENTS.md on why). Every call is wrapped:
 * a private window, blocked site data, or a storage quota can throw, and
 * that must never crash the workstation mid-shift.
 */

const PREFIX = 'a305-dialer:';

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* best-effort — the session still works from in-memory state */
  }
}
