// Shim: the IPD module shares the OPD app's singleton Supabase client.
// The OPD export is typed nullable (it stays null only when env vars are
// missing at boot); IPD code was written against a non-null client, so this
// shim re-exports it non-null via a runtime-checked getter-style constant.
import { supabase as opdSupabase } from '../../../lib/supabaseClient';

if (!opdSupabase) {
  // Same failure mode as the original IPD app when env vars were absent.
  console.error('[IPD] Supabase client not initialized — check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = opdSupabase as NonNullable<typeof opdSupabase>;
