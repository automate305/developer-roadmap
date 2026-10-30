/**
 * Shared Supabase client. Lazily constructed so the process still boots
 * (and serves /health) when SUPABASE_URL / SUPABASE_SERVICE_KEY are absent
 * in a test or Twilio-only environment.
 *
 * Uses the service-role key (bypasses RLS) because all writes originate from
 * this trusted backend, never directly from a browser. Never expose this key
 * client-side.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'db/supabase' });

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let _client = null;

export function getSupabaseClient() {
  if (_client) return _client;
  const { url, serviceKey } = config.supabase;
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY',
    );
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  log.info('supabase client initialised', { url });
  return _client;
}

export function isSupabaseConfigured() {
  return Boolean(config.supabase.url && config.supabase.serviceKey);
}

export default getSupabaseClient;
