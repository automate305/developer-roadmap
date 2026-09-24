/**
 * Reports tab — the numbers an agent actually wants after a session:
 * dialed, connects, meetings booked. Everything here is scoped to this
 * browser tab today (see AGENTS.md) — it resets on reload and isn't yet
 * written back to HubSpot. Real durability is the next step, not this one.
 */
const TILES = [
  { key: 'dialed', label: 'Dialed' },
  { key: 'humans', label: 'Connects', tone: 'good' },
  { key: 'meetingsBooked', label: 'Meetings booked', tone: 'good' },
  { key: 'machines', label: 'Voicemail' },
  { key: 'noAnswer', label: 'No answer' },
  { key: 'abandoned', label: 'Abandoned', tone: 'warn' },
];

function sumStats(sessions) {
  const totals = { dialed: 0, humans: 0, machines: 0, noAnswer: 0, abandoned: 0, failed: 0, meetingsBooked: 0 };
  for (const s of sessions) {
    for (const key of Object.keys(totals)) totals[key] += s.stats?.[key] ?? (key === 'meetingsBooked' ? s.meetingsBooked ?? 0 : 0);
  }
  return totals;
}

export default function ReportsTab({ sessionHistory }) {
  const totals = sumStats(sessionHistory);

  const connectRate = totals.dialed > 0 ? Math.round((totals.humans / totals.dialed) * 100) : null;

  return (
    <div className="tab tab--reports">
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Today</h2>
          {connectRate !== null && <span className="pill">{connectRate}% connect rate</span>}
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
        {sessionHistory.length === 0 ? (
          <p className="empty-state">
            Nothing logged yet. Numbers land here once a campaign on the <strong>Campaigns</strong> tab finishes or is
            stopped.
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
                {sessionHistory
                  .slice()
                  .reverse()
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{new Date(s.endedAt).toLocaleTimeString()}</td>
                      <td>{s.listName || 'Pasted numbers'}</td>
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
    </div>
  );
}
