/**
 * CRUD for custom_dispositions table.
 */
import { getSupabaseClient } from './supabase.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'db/dispositionsDb' });

export async function listDispositions() {
  const { data, error } = await getSupabaseClient()
    .from('custom_dispositions')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`list dispositions failed: ${error.message}`);
  return data ?? [];
}

export async function upsertDisposition({ label, requires_notes, category, sort_order }) {
  const { data, error } = await getSupabaseClient()
    .from('custom_dispositions')
    .upsert({ label, requires_notes: Boolean(requires_notes), category: category ?? 'manual', sort_order: sort_order ?? 0 }, { onConflict: 'label' })
    .select()
    .single();
  if (error) throw new Error(`upsert disposition failed: ${error.message}`);
  log.info('disposition upserted', { label });
  return data;
}

export async function deleteDisposition(id) {
  // Soft-delete: mark inactive so historical call logs still reference the label
  const { data, error } = await getSupabaseClient()
    .from('custom_dispositions')
    .update({ active: false })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`delete disposition failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export default { listDispositions, upsertDisposition, deleteDisposition };
