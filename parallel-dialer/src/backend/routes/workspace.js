/**
 * routes/workspace.js — Contacts, Lists, Session History and agent-logged
 * call outcomes. Unlike routes/api.js, nothing here touches the live dialer
 * engine; this is the persistence surface that used to be the browser's
 * localStorage only (see AGENTS.md and workspaceStore.js).
 */
import express from 'express';

import { logger } from '../../utils/logger.js';
import { createOperatorAuth } from '../operatorAuth.js';
import { isSupabaseConfigured } from '../db/supabase.js';
import { insertCallLog, updateCallLogOutcome, queryCallLogs } from '../db/callLogsDb.js';
import { fireSessionWebhook } from '../makeWebhook.js';
import { AGENT_OUTCOME_LABELS } from '../hubspotService.js';

const log = logger.child({ module: 'routes/workspace' });

/**
 * @param {object} deps
 * @param {import('../workspaceStore.js').WorkspaceStore} deps.store
 * @param {import('../callActivityQueue.js').CallActivityQueue|null} [deps.outcomeQueue]
 *   Enqueues HubSpot writes for agent-logged outcomes. `null` when HubSpot
 *   isn't configured — outcomes are then accepted but only ever persisted
 *   nowhere but the agent's own screen, same as today.
 */
export function createWorkspaceRouter({ store, outcomeQueue = null, auth = createOperatorAuth() }) {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' })); // CSV imports can be a few thousand rows

  /** Everything the workstation needs on first paint. */
  router.get('/state', auth.guard, (_req, res) => {
    res.json(store.getState());
  });

  /** Import one list and its contacts, already parsed by the frontend. */
  router.post('/lists', auth.guard, async (req, res) => {
    const { list, contacts } = req.body ?? {};
    if (!list?.id || !list?.name) return res.status(400).json({ error: 'list_required' });
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'contacts_required' });

    try {
      const result = await store.importList(list, contacts);
      return res.status(201).json(result);
    } catch (err) {
      log.error('failed to import list', { err });
      return res.status(500).json({ error: 'import_failed', message: err.message });
    }
  });

  /** Delete a list and every contact filed under it. */
  router.delete('/lists/:id', auth.guard, async (req, res) => {
    try {
      const existed = await store.deleteList(req.params.id);
      if (!existed) return res.status(404).json({ error: 'not_found' });
      return res.json({ deleted: true });
    } catch (err) {
      log.error('failed to delete list', { err });
      return res.status(500).json({ error: 'delete_failed', message: err.message });
    }
  });

  /** Append one finished session's summary. Also fires Make webhook. */
  router.post('/session-history', auth.guard, async (req, res) => {
    const summary = req.body ?? {};
    if (!summary.id) return res.status(400).json({ error: 'summary_id_required' });

    try {
      const result = await store.appendSessionHistory(summary);

      // Fire Make webhook in background — don't block the response
      fireSessionWebhook(summary).catch((err) =>
        log.warn('make webhook background fire failed', { err }),
      );

      return res.status(201).json(result);
    } catch (err) {
      log.error('failed to append session history', { err });
      return res.status(500).json({ error: 'append_failed', message: err.message });
    }
  });

  /** Log a single completed call leg to Supabase (when configured). */
  router.post('/call-logs', auth.guard, async (req, res) => {
    if (!isSupabaseConfigured()) return res.status(202).json({ accepted: false, reason: 'supabase_not_configured' });
    try {
      const row = await insertCallLog(req.body ?? {});
      return res.status(201).json(row ?? { accepted: true });
    } catch (err) {
      log.error('failed to insert call log', { err });
      return res.status(500).json({ error: err.message });
    }
  });

  /** Query call logs — filterable by sessionId, date, campaignName. */
  router.get('/call-logs', auth.guard, async (req, res) => {
    if (!isSupabaseConfigured()) return res.json([]);
    try {
      const logs = await queryCallLogs({
        sessionId:    req.query.sessionId,
        date:         req.query.date,
        campaignName: req.query.campaignName,
        limit:        req.query.limit ? Number(req.query.limit) : undefined,
      });
      return res.json(logs);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * Log an agent's own outcome for a call (Meeting booked / Follow up / Not
   * interested — see hubspotService.js's AGENT_OUTCOME_LABELS). Queued and
   * retried the same way `leg:ended` CRM writes are, so a HubSpot outage
   * doesn't silently drop it. Responds before the write completes; the
   * outcome is durable once accepted (queued or dead-lettered), not once
   * synced.
   */
  router.post('/outcomes', auth.guard, (req, res) => {
    const { callSid, sessionId, outcome, notes } = req.body ?? {};
    if (!callSid) return res.status(400).json({ error: 'callSid_required' });
    if (!outcome) return res.status(400).json({ error: 'outcome_required' });

    // Supabase call log first, independent of HubSpot: custom dispositions
    // (Interested, Wrong Number, …) have no HubSpot equivalent but still
    // belong in the log.
    if (isSupabaseConfigured()) {
      updateCallLogOutcome({ callSid, sessionId, outcome, notes: notes ?? '' }).catch((err) =>
        log.warn('supabase outcome update failed', { callSid, err }),
      );
    }

    // HubSpot only understands its own three outcome keys.
    if (!AGENT_OUTCOME_LABELS[outcome]) {
      return res.status(202).json({ accepted: isSupabaseConfigured(), reason: 'no_hubspot_mapping' });
    }

    if (!outcomeQueue) {
      log.warn('outcome logged but HubSpot is not configured — nothing to write to', { callSid, outcome });
      return res.status(202).json({ accepted: false, reason: 'hubspot_not_configured' });
    }

    const accepted = outcomeQueue.enqueue({ callSid, outcome, notes: notes ?? '' });
    return res.status(202).json({ accepted });
  });

  return router;
}

export default createWorkspaceRouter;
