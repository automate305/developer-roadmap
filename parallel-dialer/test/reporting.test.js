import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityCsv, dailyActivity, localDate } from '../src/frontend/lib/reporting.js';

const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();

describe('daily activity reports', () => {
  const sessions = [
    { endedAt: at(2026, 9, 30), stats: { dialed: 20, humans: 4 } },
    { endedAt: at(2026, 10, 1), stats: { dialed: 10, humans: 2 } },
  ];
  const outcomes = [
    { savedAt: at(2026, 9, 30), outcome: 'meaningful' },
    { savedAt: at(2026, 9, 30), outcome: 'meeting' },
    { savedAt: at(2026, 10, 1), outcome: 'callback' },
  ];

  it('uses the operator-local calendar day and inclusive start/end', () => {
    assert.equal(localDate(at(2026, 9, 30)), '2026-09-30');
    assert.deepEqual(dailyActivity(sessions, outcomes, '2026-09-30', '2026-09-30'), [
      { date: '2026-09-30', dialed: 20, connections: 4, meaningful: 1, meetings: 1 },
    ]);
  });

  it('leaves a blank end open through the present and exports only filtered rows', () => {
    const rows = dailyActivity(sessions, outcomes, '2026-10-01', '');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].connections, 2);
    assert.equal(activityCsv(rows), 'date,dialed,connections,meaningful_conversations,meetings_booked\r\n2026-10-01,10,2,0,0\r\n');
  });
});
