/**
 * SettingsPanel — tabbed overlay behind the gear icon.
 *
 * Tabs:
 *  1. Audio Diagnostics  — mic / speaker test (original gear-icon content)
 *  2. Dispositions       — add/edit/delete custom disposition rules
 *  3. Team & Security    — add user, toggle dark/light mode
 *  4. Telephony          — view/manage SignalWire phone numbers
 *  5. Platform Links     — quick jump to GitHub, Railway, SignalWire
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PLATFORM_LINKS = [
  { label: 'GitHub', href: 'https://github.com/automate305/developer-roadmap', icon: '⌥' },
  { label: 'Railway', href: 'https://railway.app', icon: '🚂' },
  { label: 'SignalWire Dashboard', href: 'https://signalwire.com', icon: '📡' },
];

export default function SettingsPanel({ onClose, theme, onToggleTheme, apiBase, authHeaders }) {
  const [tab, setTab] = useState('audio');
  const [dispositions, setDispositions] = useState([]);
  const [dispLoading, setDispLoading] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newRequiresNotes, setNewRequiresNotes] = useState(false);
  const [newCategory, setNewCategory] = useState('manual');
  const [swNumbers, setSwNumbers] = useState([]);

  // ── Dispositions ────────────────────────────────────────────────────────
  const loadDispositions = useCallback(async () => {
    setDispLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/dispositions`, { headers: authHeaders });
      if (res.ok) setDispositions(await res.json());
    } catch { /* silently ignore */ }
    finally { setDispLoading(false); }
  }, [apiBase, authHeaders]);

  useEffect(() => {
    if (tab === 'dispositions') loadDispositions();
  }, [tab, loadDispositions]);

  async function addDisposition() {
    if (!newLabel.trim()) return;
    try {
      const res = await fetch(`${apiBase}/api/dispositions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ label: newLabel.trim(), requires_notes: newRequiresNotes, category: newCategory }),
      });
      if (res.ok) {
        setNewLabel('');
        setNewRequiresNotes(false);
        await loadDispositions();
      }
    } catch { /* ignore */ }
  }

  async function deleteDisposition(id) {
    try {
      await fetch(`${apiBase}/api/dispositions/${id}`, { method: 'DELETE', headers: authHeaders });
      await loadDispositions();
    } catch { /* ignore */ }
  }

  // ── Telephony (read from Railway env — surface only, no writes) ─────────
  const callerIdDisplay = import.meta.env.VITE_SIGNALWIRE_CALLER_ID ?? 'Not set';

  return (
    <div className="modal-overlay settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal settings-modal">
        <div className="settings__head">
          <h2 className="settings__title">Settings</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings__tabs" role="tablist">
          {[
            { key: 'audio', label: 'Audio' },
            { key: 'dispositions', label: 'Dispositions' },
            { key: 'team', label: 'Team' },
            { key: 'telephony', label: 'Telephony' },
            { key: 'links', label: 'Links' },
          ].map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              className={`settings__tab ${tab === key ? 'settings__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="settings__body">

          {/* ── Audio Diagnostics ────────────────────────────────────── */}
          {tab === 'audio' && (
            <div className="settings__section">
              <h3 className="settings__section-title">Audio Diagnostics</h3>
              <p className="settings__hint">Test your microphone and speakers before a session.</p>
              <AudioDiagnostics />
            </div>
          )}

          {/* ── Dispositions ─────────────────────────────────────────── */}
          {tab === 'dispositions' && (
            <div className="settings__section">
              <h3 className="settings__section-title">Custom Dispositions</h3>
              <p className="settings__hint">Auto-category dispositions skip the notes window. Manual ones open the 15-second notes modal.</p>

              {dispLoading ? (
                <p className="settings__loading">Loading…</p>
              ) : (
                <table className="sheet__table">
                  <thead>
                    <tr><th>Label</th><th>Category</th><th>Requires Notes</th><th></th></tr>
                  </thead>
                  <tbody>
                    {dispositions.map((d) => (
                      <tr key={d.id}>
                        <td>{d.label}</td>
                        <td><span className={`pill pill--${d.category === 'auto' ? 'muted' : 'accent'}`}>{d.category}</span></td>
                        <td>{d.requires_notes ? '✓' : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => deleteDisposition(d.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="settings__add-row">
                <input
                  className="input"
                  placeholder="New disposition label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addDisposition()}
                />
                <select className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="auto">Auto (skip notes)</option>
                </select>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={newRequiresNotes}
                    onChange={(e) => setNewRequiresNotes(e.target.checked)}
                  />
                  Requires notes
                </label>
                <button type="button" className="btn btn--primary" onClick={addDisposition}>Add</button>
              </div>
            </div>
          )}

          {/* ── Team & Security ───────────────────────────────────────── */}
          {tab === 'team' && (
            <div className="settings__section">
              <h3 className="settings__section-title">Team &amp; Security</h3>

              <div className="settings__row">
                <span>Theme</span>
                <button type="button" className="btn" onClick={onToggleTheme}>
                  Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
                </button>
              </div>

              <div className="settings__hint settings__hint--info">
                To add a new system user, update the <code>DIALER_API_KEY</code> in Railway and share the key with the new agent. Each agent uses the same key to log in. Multi-user access with individual accounts is a future milestone.
              </div>
            </div>
          )}

          {/* ── Telephony ────────────────────────────────────────────── */}
          {tab === 'telephony' && (
            <div className="settings__section">
              <h3 className="settings__section-title">Telephony Infrastructure</h3>

              <div className="settings__row">
                <span>Active Caller ID</span>
                <span className="mono">{callerIdDisplay}</span>
              </div>

              <div className="settings__hint settings__hint--info">
                To update your outbound caller ID or add a new SignalWire number:
                <ol>
                  <li>Provision the number in the <a href="https://signalwire.com" target="_blank" rel="noopener noreferrer">SignalWire Dashboard</a></li>
                  <li>Update <code>SIGNALWIRE_CALLER_ID</code> in Railway Variables</li>
                  <li>Redeploy the service</li>
                  <li>Register the new number at <a href="https://freecallerregistry.com" target="_blank" rel="noopener noreferrer">freecallerregistry.com</a></li>
                </ol>
              </div>
            </div>
          )}

          {/* ── Platform Links ────────────────────────────────────────── */}
          {tab === 'links' && (
            <div className="settings__section">
              <h3 className="settings__section-title">Platform Jump-Links</h3>
              <div className="links-grid">
                {PLATFORM_LINKS.map(({ label, href, icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-card"
                  >
                    <span className="link-card__icon">{icon}</span>
                    <span className="link-card__label">{label}</span>
                    <span className="link-card__arrow">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Audio diagnostics sub-component ──────────────────────────────────────────

function AudioDiagnostics() {
  const [micLevel, setMicLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  async function startMicTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      setTesting(true);

      function tick() {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      setMicLevel(-1);
    }
  }

  function stopMicTest() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setTesting(false);
    setMicLevel(0);
  }

  useEffect(() => () => stopMicTest(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="audio-diag">
      <div className="settings__row">
        <span>Microphone</span>
        <button type="button" className="btn" onClick={testing ? stopMicTest : startMicTest}>
          {testing ? 'Stop test' : 'Test mic'}
        </button>
      </div>
      {testing && (
        <div className="meter">
          <span className="meter__label">Input level</span>
          <div className="meter__track">
            <div className="meter__fill" style={{ width: `${Math.max(0, micLevel)}%` }} />
          </div>
          <span className="mono" style={{ fontSize: '0.75rem' }}>{micLevel}%</span>
        </div>
      )}
      {micLevel === -1 && (
        <p className="settings__hint settings__hint--warn">Microphone access denied. Check browser permissions.</p>
      )}
      <p className="settings__hint">Speakers: play a short audio clip through your browser to test output.</p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 440;
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
          osc.start(); osc.stop(ctx.currentTime + 0.8);
        }}
      >
        Play tone
      </button>
    </div>
  );
}
