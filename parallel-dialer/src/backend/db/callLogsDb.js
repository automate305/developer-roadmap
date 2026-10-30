/**
 * Call log writes — one row per dialed leg, plus agent outcome updates.
 * The session_reports table is written via workspaceDb.appendSessionHistory.
 */
import { getSupabaseClient } from './supabase.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'db/callLogsDb' });

/**
 * Insert one completed leg into call_logs.
 * @param {object} entry
 */
export async function insertCallLog(entry) {
  const row = {
    session_id:        entry.sessionId,
    campaign_name:     entry.campaignName ?? 'General Outbound',
    prospect_phone:    entry.phone,
    prospect_name:     entry.name ?? null,
    prospect_company:  entry.company ?? null,
    contact_id:        entry.contactId ?? null,
    call_sid:          entry.callSid ?? null,
    duration_seconds:  entry.durationSeconds ?? 0,
    disposition:       entry.disposition ?? null,
    amd_transcript:    entry.transcript ?? null,
    agent_outcome:     entry.agentOutcome ?? null,
    notes:             entry.notes ?? null,
    dialed_at:         entry.dialedAt ? new Date(entry.dialedAt).toISOString() : new Date().toISOString(),
  };

  const { error } = await getSupabaseClient().from('call_logs').insert(row);
  if (error) {
    log.warn('call log insert failed', { phone: entry.phone, error: error.message });
    return null;
  }
  return row;
}

/**
 * Attach agent outcome + notes to the most recent call_log row for this callSid.
 */
export async function updateCallLogOutcome({ callSid, sessionId, outcome, notes }) {
  const db = getSupabaseClient();

  // Find most recent row for this call
  let query = db.from('call_logs').update({ agent_outcome: outcome, notes: notes ?? null });

  if (callSid) {
    query = query.eq('call_sid', callSid);
  } else if (sessionId) {
    query = query.eq('session_id', sessionId).order('dialed_at', { ascending: false }).limit(1);
  } else {
    log.warn('updateCallLogOutcome called with no callSid or sessionId');
    return;
  }

  const { error } = await query;
  if (error) log.warn('call log outcome update failed', { callSid, error: error.message });
}

/**
 * Query call logs for the Reports tab.
 * @param {{ sessionId?: string, date?: string, campaignName?: string, limit?: number }} filters
 */
export async function queryCallLogs({ sessionId, date, campaignName, limit = 500 } = {}) {
  let q = getSupabaseClient()
    .from('call_logs')
    .select('*')
    .order('dialed_at', { ascending: false })
    .limit(limit);

  if (sessionId) q = q.eq('session_id', sessionId);
  if (date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);
    q = q.gte('dialed_at', start.toISOString()).lte('dialed_at', end.toISOString());
  }
  if (campaignName) q = q.eq('campaign_name', campaignName);

  const { data, error } = await q;
  if (error) throw new Error(`query call logs failed: ${error.message}`);
  return data ?? [];
}

export default { insertCallLog, updateCallLogOutcome, queryCallLogs };
