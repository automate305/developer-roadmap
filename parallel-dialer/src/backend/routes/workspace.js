/**
 * routes/workspace.js — Contacts, Lists, Session History and agent-logged
 * call outcomes. This is the persistence surface that used to be the browser's
 * localStorage only (see AGENTS.md and workspaceStore.js). A saved DNC outcome
 * also removes matching future leads from the live engine queue.
 */
import express from 'express';

import { logger } from '../../utils/logger.js';
import { createOperatorAuth } from '../operatorAuth.js';

const log = logger.child({ module: 'routes/workspace' });

/**
 * @param {object} deps
 * @param {import('../workspaceStore.js').WorkspaceStore} deps.store
 * @param {import('../callActivityQueue.js').CallActivityQueue|null} [deps.outcomeQueue]
 *   Enqueues HubSpot writes for agent-logged outcomes. `null` when HubSpot
 *   isn't configured — outcomes still persist in the workspace store.
 */
export function createWorkspaceRouter({ store, outcomeQueue = null, engine = null, auth = createOperatorAuth() }) {
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

  /** Append one finished session's summary. */
  router.post('/session-history', auth.guard, async (req, res) => {
    const summary = req.body ?? {};
    if (!summary.id) return res.status(400).json({ error: 'summary_id_required' });

    try {
      const result = await store.appendSessionHistory(summary);
      return res.status(201).json(result);
    } catch (err) {
      log.error('failed to append session history', { err });
      return res.status(500).json({ error: 'append_failed', message: err.message });
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
  router.post('/outcomes', auth.guard, async (req, res) => {
    const { callSid, outcome, notes, phone, durationSeconds, connectedAt } = req.body ?? {};
    if (!callSid) return res.status(400).json({ error: 'callSid_required' });
    if (!['meeting', 'callback', 'meaningful', 'email', 'not_interested', 'do_not_call'].includes(outcome)) {
      return res.status(400).json({ error: 'invalid_outcome' });
    }

    try {
      const saved = await store.appendCallOutcome({
        callSid: String(callSid), outcome, notes: String(notes ?? '').slice(0, 10000),
        phone: String(phone ?? ''), durationSeconds: Number(durationSeconds) || 0,
        connectedAt: Number(connectedAt) || null, savedAt: Date.now(),
      });
      if (outcome === 'do_not_call' && saved.phone) engine?.suppressPhone(saved.phone);
      const crmQueued = outcomeQueue ? outcomeQueue.enqueue({ callSid, outcome, notes: saved.notes }) : false;
      return res.status(201).json({ saved: true, crmQueued });
    } catch (err) {
      log.error('failed to persist call outcome', { err });
      return res.status(500).json({ error: 'outcome_save_failed' });
    }
  });

  return router;
}

export default createWorkspaceRouter;
