/**
 * NotesModal — shown after a call that reached a human ends.
 *
 * A 15-second countdown starts on open. When it expires, or the agent clicks
 * "Submit & Next", onSubmit fires with whatever is selected/typed so far and
 * the dialer moves on to the next lead. Calls that never reached a human
 * skip this modal entirely (the engine just waits a short beat and redials).
 */
import { useEffect, useRef, useState } from 'react';

const AUTO_ADVANCE_SECONDS = 15;

export default function NotesModal({ prospectInfo, dispositions, onSubmit, onSkip }) {
  const [notes, setNotes] = useState('');
  const [selectedDisposition, setSelectedDisposition] = useState(null);
  const [countdown, setCountdown] = useState(AUTO_ADVANCE_SECONDS);
  const timerRef = useRef(null);

  // The countdown fires from a timer, so it reads the latest disposition,
  // notes and callback through a ref rather than the first render's closure.
  const latest = useRef({});
  latest.current = { disposition: selectedDisposition, notes, onSubmit };

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) clearInterval(timerRef.current);
        return Math.max(0, n - 1);
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (countdown === 0) {
      const { disposition, notes: text, onSubmit: submit } = latest.current;
      submit({ disposition, notes: text });
    }
  }, [countdown]);

  function handleSubmit() {
    clearInterval(timerRef.current);
    onSubmit({ disposition: selectedDisposition, notes });
  }

  const manualDispositions = dispositions.filter((d) => d.category === 'manual' || d.requires_notes);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Call notes">
      <div className="modal">
        <div className="modal__head">
          <div>
            <h2 className="modal__title">Log this call</h2>
            {prospectInfo?.company && (
              <p className="modal__subtitle">{prospectInfo.company}{prospectInfo.name ? ` — ${prospectInfo.name}` : ''}</p>
            )}
            <p className="mono modal__phone">{prospectInfo?.phone ?? '—'}</p>
          </div>
          <div className="countdown" aria-label={`Auto-advancing in ${countdown} seconds`}>
            <svg className="countdown__ring" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--line)" strokeWidth="2" />
              <circle
                cx="18" cy="18" r="15.9" fill="none"
                stroke="var(--purple)"
                strokeWidth="2"
                strokeDasharray={`${(countdown / AUTO_ADVANCE_SECONDS) * 100} 100`}
                strokeLinecap="round"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="countdown__num">{countdown}</span>
          </div>
        </div>

        <div className="modal__body">
          <div className="disposition-grid">
            {manualDispositions.map((d) => (
              <button
                key={d.id ?? d.label}
                type="button"
                className={`disposition-btn ${selectedDisposition === d.label ? 'disposition-btn--selected' : ''}`}
                onClick={() => setSelectedDisposition(d.label)}
              >
                {d.label}
              </button>
            ))}
          </div>

          <textarea
            className="textarea"
            rows={3}
            placeholder="Notes, next steps, what was said…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="modal__foot row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={!selectedDisposition}
          >
            Submit &amp; Next
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => { clearInterval(timerRef.current); onSkip(); }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
