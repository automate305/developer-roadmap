#!/usr/bin/env node
/**
 * score-amd.mjs — what the answer detector actually did, and what it got wrong.
 *
 *   node scripts/score-amd.mjs [path-to-amd-audit.jsonl]
 *
 * Reads the audit log and reports two things, which matter unequally:
 *
 *   1. What the classifier DID — verdict counts, decision latency, the reasons
 *      that fired. Available from production traffic alone.
 *
 *   2. What it got WRONG — the confusion matrix. This needs `actual` labels,
 *      and for MACHINE and NO_ANSWER a human has to supply them, because the
 *      call was hung up and nothing downstream ever learns the truth.
 *
 * The second section reports its own blind spot explicitly rather than quietly
 * scoring whatever happens to be labelled. A false-MACHINE rate computed from
 * zero labelled MACHINE decisions is not a low error rate; it is no measurement
 * at all, and that difference is the reason this script exists.
 *
 * To label: open the file, find records with "actual": null, and set it to
 * "HUMAN", "MACHINE" or "NO_ANSWER" by reading the transcript. Sampling 150–200
 * MACHINE verdicts is enough to see a real problem.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const VERDICTS = ['HUMAN', 'MACHINE', 'NO_ANSWER'];
const file = process.argv[2] ?? process.env.AMD_AUDIT_PATH ?? './data/amd-audit.jsonl';

async function load(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`No audit log at ${path.resolve(filePath)}`);
      console.error('Set AMD_AUDIT_PATH and place some calls, or pass the path as an argument.');
      process.exit(1);
    }
    throw err;
  }

  const records = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      skipped += 1;
    }
  }
  if (skipped) console.error(`(skipped ${skipped} unparseable line(s))\n`);
  return records;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const pad = (s, n) => String(s).padEnd(n);

function reportGroup(configHash, records) {
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`config ${configHash}  ·  ${records.length} decisions`);
  console.log('─'.repeat(72));

  console.log('\nVERDICTS AND LATENCY');
  for (const verdict of VERDICTS) {
    const rows = records.filter((r) => r.classification === verdict);
    if (rows.length === 0) continue;
    const lat = rows.map((r) => r.latencyMs).filter((n) => typeof n === 'number').sort((a, b) => a - b);
    const share = ((rows.length / records.length) * 100).toFixed(1);
    console.log(
      `  ${pad(verdict, 11)} ${pad(rows.length, 6)} ${pad(`${share}%`, 8)}` +
        (lat.length ? `p50 ${pad(`${percentile(lat, 50)}ms`, 9)}p90 ${percentile(lat, 90)}ms` : 'no latency recorded'),
    );
  }

  const abandoned = records.filter((r) => r.classification === 'HUMAN' && r.won === false);
  if (abandoned.length) {
    const rate = ((abandoned.length / records.length) * 100).toFixed(2);
    console.log(`\n  abandoned  ${abandoned.length} (${rate}% of decisions) — a human answered a leg that lost its race`);
  }

  console.log('\nREASONS THAT FIRED');
  const byReason = new Map();
  for (const r of records) {
    const key = (r.reason ?? 'none').split(':')[0];
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(reason, 28)} ${n}`);
  }

  console.log('\nERROR RATES');
  const labelled = records.filter((r) => r.actual && VERDICTS.includes(r.actual));

  if (labelled.length === 0) {
    console.log('  Nothing is labelled, so no error rate can be computed.');
    console.log('  Label some records (set "actual") and run this again.');
  } else {
    console.log(`  ${labelled.length} of ${records.length} decisions labelled\n`);
    console.log(`  ${pad('said \\ was', 13)}${VERDICTS.map((v) => pad(v, 11)).join('')}`);
    for (const said of VERDICTS) {
      const row = VERDICTS.map((was) =>
        pad(labelled.filter((r) => r.classification === said && r.actual === was).length, 11),
      );
      console.log(`  ${pad(said, 13)}${row.join('')}`);
    }
    console.log('');
    for (const verdict of VERDICTS) {
      const said = labelled.filter((r) => r.classification === verdict);
      if (said.length === 0) continue;
      const wrong = said.filter((r) => r.actual !== verdict).length;
      console.log(`  false ${pad(verdict, 11)} ${wrong}/${said.length}  (${((wrong / said.length) * 100).toFixed(1)}%)`);
    }
  }

  console.log('\nWHAT IS STILL UNMEASURED');
  for (const verdict of VERDICTS) {
    const total = records.filter((r) => r.classification === verdict).length;
    if (total === 0) continue;
    const done = records.filter((r) => r.classification === verdict && r.actual).length;
    const observable = verdict === 'HUMAN' ? 'the agent hears the truth' : 'nothing downstream ever learns the truth';
    const flag = done === 0 && verdict !== 'HUMAN' ? '   <-- blind' : '';
    console.log(`  ${pad(verdict, 11)} ${pad(`${done}/${total} labelled`, 22)}${observable}${flag}`);
  }
}

const records = await load(file);
if (records.length === 0) {
  console.error('The audit log is empty.');
  process.exit(1);
}

console.log(`\nAMD audit · ${records.length} decisions · ${path.resolve(file)}`);

const groups = new Map();
for (const r of records) {
  const key = r.configHash ?? 'unknown';
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

if (groups.size > 1) {
  console.log(
    `\n${groups.size} classifier configurations present. Reported separately — a threshold or\n` +
      'pattern change makes every earlier decision an answer to a different question.',
  );
}

for (const [configHash, group] of groups) reportGroup(configHash, group);
console.log('');
