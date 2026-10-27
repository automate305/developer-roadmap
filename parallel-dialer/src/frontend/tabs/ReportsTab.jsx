import { useMemo, useState } from 'react';
import { activityCsv, dailyActivity, localDate } from '../lib/reporting.js';

export default function ReportsTab({ sessionHistory, callOutcomes }) {
  const [from, setFrom] = useState(() => localDate(Date.now()));
  const [through, setThrough] = useState('');
  const [metric, setMetric] = useState('all');
  const rows = useMemo(() => dailyActivity(sessionHistory, callOutcomes, from, through), [sessionHistory, callOutcomes, from, through]);
  const totals = rows.reduce((sum, row) => ({ dialed: sum.dialed + row.dialed,
    connections: sum.connections + row.connections, meaningful: sum.meaningful + row.meaningful,
    meetings: sum.meetings + row.meetings }), { dialed: 0, connections: 0, meaningful: 0, meetings: 0 });
  const shown = metric === 'all' ? rows : rows.filter((row) => row[metric] > 0);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([activityCsv(shown)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `a305-dialer-activity-${from || 'all'}-to-${through || 'present'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="tab tab--reports">
    <section className="panel">
      <div className="panel__head"><h2 className="panel__title">Activity report</h2>
        <button type="button" className="btn btn--primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button></div>
      <div className="row reports__filters">
        <button type="button" className="btn" onClick={() => { setFrom(localDate(Date.now())); setThrough(''); }}>Today</button>
        <button type="button" className="btn" onClick={() => { setFrom(''); setThrough(''); }}>All time</button>
        <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">Through (blank = present)<input type="date" value={through} min={from || undefined} onChange={(e) => setThrough(e.target.value)} /></label>
        <label className="field">Show
          <select className="select" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="all">All days</option><option value="connections">Days with connections</option>
            <option value="meaningful">Days with meaningful conversations</option><option value="meetings">Days with meetings</option>
          </select></label>
      </div>
      {through && from && through < from && <p role="alert" className="bridge-notice">End date must be on or after start date.</p>}
      <div className="tiles">
        {[['dialed', 'Dialed'], ['connections', 'Connections'], ['meaningful', 'Meaningful conversations'], ['meetings', 'Meetings booked']].map(([key, label]) =>
          <div key={key} className="tile"><dt>{label}</dt><dd className="mono">{totals[key]}</dd></div>)}
      </div>
      <p className="reports__note">Connections come from completed session summaries; meaningful conversations and meetings come from saved dispositions. In-progress sessions and earlier calls without dispositions may not appear yet.</p>
    </section>
    <section className="panel"><h2 className="panel__title">By day</h2>
      {shown.length === 0 ? <p className="empty-state">No activity matches these dates and filters.</p> :
        <div className="sheet"><table className="sheet__table"><thead><tr><th>Date</th><th>Dialed</th><th>Connections</th><th>Meaningful conversations</th><th>Meetings booked</th></tr></thead>
          <tbody>{shown.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.dialed}</td><td>{row.connections}</td><td>{row.meaningful}</td><td>{row.meetings}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
