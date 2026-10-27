/** Calendar dates in the operator's browser timezone, not UTC. */
export function localDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dailyActivity(sessions, outcomes, from, through) {
  const days = new Map();
  const rowFor = (date) => {
    if (!days.has(date)) days.set(date, { date, dialed: 0, connections: 0, meaningful: 0, meetings: 0 });
    return days.get(date);
  };
  const inside = (date) => date && (!from || date >= from) && (!through || date <= through);
  for (const session of sessions) {
    const date = localDate(session.endedAt);
    if (!inside(date)) continue;
    const row = rowFor(date);
    row.dialed += Number(session.stats?.dialed) || 0;
    row.connections += Number(session.stats?.humans) || 0;
  }
  for (const outcome of outcomes) {
    const date = localDate(outcome.savedAt);
    if (!inside(date)) continue;
    const row = rowFor(date);
    if (outcome.outcome === 'meaningful') row.meaningful += 1;
    if (outcome.outcome === 'meeting') row.meetings += 1;
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function activityCsv(rows) {
  return ['date,dialed,connections,meaningful_conversations,meetings_booked',
    ...rows.map((row) => [row.date, row.dialed, row.connections, row.meaningful, row.meetings].join(','))].join('\r\n') + '\r\n';
}
