/**
 * Reports tab — the numbers an agent actually wants after a session:
 * dialed, connects, meetings booked, and how the conversations landed.
 *
 * Session totals come from session history (server-side). When Supabase is
 * configured the per-call log is shown too, via /api/workspace/call-logs;
 * without it that endpoint answers an empty list and the table is hidden.
 */
import { useEffect, useMemo, useState } from 'react';

const TILES = [
  { key: 'dialed', label: 'Dialed' },
  { key: 'humans', label: 'Connects', tone: 'good' },
  { key: 'meetingsBooked', label: 'Meetings booked', tone: 'good' },
  { key: 'interested', label: 'Interested', tone: 'good' },
  { key: 'callbacks', label: 'Callbacks' },
  { key: 'notInterested', label: 'Not interested' },
  { key: 'machines', label: 'Voicemail' },
  { key: 'noAnswer', label: 'No answer' },
  { key: 'busy', label: 'Busy' },
  { key: 'abandoned', label: 'Abandoned', tone: 'warn' },
];

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'campaign', label: 'By campaign' },
  { key: 'all', label: 'All time' },
];

const SESSION_LABEL = (s) => s.listName || 'Pasted numbers';

function sumStats(sessions) {
  const totals = Object.fromEntries(TILES.map((t) => [t.key, 0]));
  totals.failed = 0;
  for (const s of sessions) {
    for (const key of Object.keys(totals)) {
      totals[key] += key === 'meetingsBooked' ? s.meetingsBooked ?? s.stats?.meetingsBooked ?? 0 : s.stats?.[key] ?? 0;
    }
  }
  return totals;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function ReportsTab({ sessionHistory, apiBase = '' }) {
  const [range, setRange] = useState('today');
  const [campaign, setCampaign] = useState('');
  const [callLogs, setCallLogs] = useState([]);

  const campaigns = useMemo(() => [...new Set(sessionHistory.map(SESSION_LABEL))], [sessionHistory]);
  const activeCampaign = campaign || campaigns[0] || '';

  const filtered = useMemo(() => {
    if (range === 'today') return sessionHistory.filter((s) => (s.endedAt ?? 0) >= startOfToday());
    if (range === 'campaign') return sessionHistory.filter((s) => SESSION_LABEL(s) === activeCampaign);
    return sessionHistory;
  }, [sessionHistory, range, activeCampaign]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: '200' });
    if (range === 'today') params.set('date', new Date().toISOString());
    if (range === 'campaign' && activeCampaign) params.set('campaignName', activeCampaign);
    fetch(`${apiBase}/api/workspace/call-logs?${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (!cancelled) setCallLogs(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setCallLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, range, activeCampaign, sessionHistory.length]);

  const totals = sumStats(filtered);
  const connectRate = totals.dialed > 0 ? Math.round((totals.humans / totals.dialed) * 100) : null;

  return (
    <div className="tab tab--reports">
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{RANGES.find((r) => r.key === range).label}</h2>
          {connectRate !== null && <span className="pill">{connectRate}% connect rate</span>}
        </div>

        <div className="row" role="group" aria-label="Report range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`btn ${range === r.key ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
          {range === 'campaign' && campaigns.length > 0 && (
            <select className="input" value={activeCampaign} onChange={(e) => setCampaign(e.target.value)}>
              {campaigns.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="tiles">
          {TILES.map((tile) => (
            <div key={tile.key} className={`tile ${tile.tone ? `tile--${tile.tone}` : ''}`}>
              <dt>{tile.label}</dt>
              <dd className="mono">{totals[tile.key] ?? 0}</dd>
            </div>
          ))}
        </div>
        <p className="reports__note">A campaign in progress shows its own live numbers on Campaigns — these totals fill in once it ends.</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Sessions</h2>
        {filtered.length === 0 ? (
          <p className="empty-state">
            Nothing logged for this view. Numbers land here once a campaign on the <strong>Campaigns</strong> tab
            finishes or is stopped.
          </p>
        ) : (
          <div className="sheet">
            <table className="sheet__table sheet__table--reports">
              <thead>
                <tr>
                  <th>Ended</th>
                  <th>List</th>
                  <th>Mode</th>
                  <th>Dialed</th>
                  <th>Connects</th>
                  <th>Voicemail</th>
                  <th>Meetings</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice()
                  .reverse()
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{new Date(s.endedAt).toLocaleString()}</td>
                      <td>{SESSION_LABEL(s)}</td>
                      <td>{s.mode === 'parallel' ? 'Parallel' : 'Power'}</td>
                      <td className="mono">{s.stats?.dialed ?? 0}</td>
                      <td className="mono">{s.stats?.humans ?? 0}</td>
                      <td className="mono">{s.stats?.machines ?? 0}</td>
                      <td className="mono">{s.meetingsBooked ?? 0}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {callLogs.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Call log</h2>
          <div className="sheet">
            <table className="sheet__table sheet__table--reports">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Prospect</th>
                  <th>Phone</th>
                  <th>Result</th>
                  <th>Outcome</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {callLogs.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{new Date(row.dialed_at).toLocaleTimeString()}</td>
                    <td>{row.prospect_company || row.prospect_name || '—'}</td>
                    <td className="mono">{row.prospect_phone}</td>
                    <td>{row.disposition ?? '—'}</td>
                    <td>{row.agent_outcome ?? '—'}</td>
                    <td>{row.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
