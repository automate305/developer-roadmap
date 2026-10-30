/**
 * Supabase-backed replacement for workspaceStore.js.
 * Mirrors the same method signatures so server.js can swap between them
 * based on whether SUPABASE_URL is configured.
 */
import { getSupabaseClient } from './supabase.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'db/workspaceDb' });

export class WorkspaceDb {
  constructor() {
    this.loaded = true; // no async boot needed
  }

  get db() {
    return getSupabaseClient();
  }

  async load() {
    // No-op: Supabase reads on demand
    log.info('workspace db ready (supabase)');
  }

  async getState() {
    const [{ data: contacts }, { data: lists }, { data: sessionHistory }] = await Promise.all([
      this.db.from('contacts').select('*').order('created_at', { ascending: true }),
      this.db.from('contact_lists').select('*').order('imported_at', { ascending: true }),
      this.db.from('session_reports').select('*').order('end_time', { ascending: false }).limit(100),
    ]);

    return {
      contacts: contacts ?? [],
      lists: (lists ?? []).map(dbListToFrontend),
      sessionHistory: (sessionHistory ?? []).map(dbSessionToFrontend),
    };
  }

  async importList(list, contacts) {
    if (!list?.id || !list?.name) throw new Error('list requires id and name');
    if (!Array.isArray(contacts)) throw new Error('contacts must be an array');

    const { error: listErr } = await this.db.from('contact_lists').upsert({
      id: list.id,
      name: list.name,
      count: list.count ?? contacts.length,
      dialable_count: list.dialableCount ?? contacts.length,
      campaign_name: list.campaignName ?? 'General Outbound',
      imported_at: new Date(list.importedAt ?? Date.now()).toISOString(),
    });
    if (listErr) throw new Error(`list insert failed: ${listErr.message}`);

    if (contacts.length > 0) {
      const rows = contacts.map((c) => ({
        id: c.id,
        list_id: c.listId ?? list.id,
        phone: c.phone,
        name: c.name ?? null,
        company: c.company ?? null,
        email: c.email ?? null,
        raw: c,
      }));
      // Insert in chunks of 500 to stay under Supabase payload limits
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await this.db.from('contacts').upsert(rows.slice(i, i + 500));
        if (error) throw new Error(`contact insert failed: ${error.message}`);
      }
    }

    log.info('list imported to supabase', { listId: list.id, contactCount: contacts.length });
    return { list, contacts };
  }

  async deleteList(listId) {
    const { data, error } = await this.db
      .from('contact_lists')
      .delete()
      .eq('id', listId)
      .select('id');
    if (error) throw new Error(`delete list failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async appendSessionHistory(summary) {
    if (!summary?.id) throw new Error('session summary requires an id');
    const row = frontendSessionToDb(summary);
    const { error } = await this.db.from('session_reports').upsert(row);
    if (error) throw new Error(`session history insert failed: ${error.message}`);
    return summary;
  }
}

// ── Shape adapters ────────────────────────────────────────────────────────────

function dbListToFrontend(row) {
  return {
    id: row.id,
    name: row.name,
    count: row.count,
    dialableCount: row.dialable_count,
    campaignName: row.campaign_name,
    importedAt: new Date(row.imported_at).getTime(),
  };
}

function dbSessionToFrontend(row) {
  return {
    id: row.session_id,
    listName: row.list_name,
    mode: row.mode,
    endedAt: new Date(row.end_time).getTime(),
    meetingsBooked: row.meetings_booked ?? 0,
    stats: row.raw_kpi_payload?.stats ?? {
      dialed: row.total_calls,
      humans: row.total_conversations,
      machines: row.voicemails,
      noAnswer: row.no_answer,
      abandoned: row.abandoned,
      failed: row.failed,
    },
  };
}

function frontendSessionToDb(summary) {
  const stats = summary.stats ?? {};
  return {
    session_id: summary.id,
    list_name: summary.listName ?? null,
    campaign_name: summary.campaignName ?? 'General Outbound',
    mode: summary.mode ?? 'power',
    start_time: new Date(summary.startedAt ?? Date.now()).toISOString(),
    end_time: new Date(summary.endedAt ?? Date.now()).toISOString(),
    total_calls: stats.dialed ?? 0,
    total_conversations: stats.humans ?? 0,
    meetings_booked: summary.meetingsBooked ?? 0,
    interested: stats.interested ?? 0,
    not_interested: stats.notInterested ?? 0,
    callbacks: stats.callbacks ?? 0,
    voicemails: stats.machines ?? 0,
    no_answer: stats.noAnswer ?? 0,
    busy: stats.busy ?? 0,
    failed: stats.failed ?? 0,
    abandoned: stats.abandoned ?? 0,
    raw_kpi_payload: summary,
  };
}

export default WorkspaceDb;
