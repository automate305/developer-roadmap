/**
 * /api/dispositions — CRUD for custom call dispositions.
 * Requires Supabase; returns 503 when not configured.
 */
import express from 'express';
import { isSupabaseConfigured } from '../db/supabase.js';
import { listDispositions, upsertDisposition, deleteDisposition } from '../db/dispositionsDb.js';
import { createOperatorAuth } from '../operatorAuth.js';

export function createDispositionsRouter({ auth = createOperatorAuth() } = {}) {
  const router = express.Router();
  router.use(express.json());

  function requireSupabase(req, res, next) {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'supabase_not_configured' });
    }
    return next();
  }

  router.get('/', auth.guard, requireSupabase, async (_req, res) => {
    try {
      const rows = await listDispositions();
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/', auth.guard, requireSupabase, async (req, res) => {
    const { label, requires_notes, category, sort_order } = req.body ?? {};
    if (!label) return res.status(400).json({ error: 'label_required' });
    try {
      const row = await upsertDisposition({ label, requires_notes, category, sort_order });
      return res.status(201).json(row);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id', auth.guard, requireSupabase, async (req, res) => {
    const { label, requires_notes, category, sort_order } = req.body ?? {};
    if (!label) return res.status(400).json({ error: 'label_required' });
    try {
      const row = await upsertDisposition({ label, requires_notes, category, sort_order });
      return res.json(row);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', auth.guard, requireSupabase, async (req, res) => {
    try {
      const existed = await deleteDisposition(Number(req.params.id));
      if (!existed) return res.status(404).json({ error: 'not_found' });
      return res.json({ deleted: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createDispositionsRouter;
