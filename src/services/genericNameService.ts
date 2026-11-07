import { supabase } from '../lib/supabase';
import { supabaseUrl } from '../lib/supabaseClient';
import type { MedicineMaster } from '../types';
import { genericNameReviewReason } from '../utils/genericNameMatching';
import type { GenericNameReview } from '../utils/genericNameMatching';
interface SaveGenericName {
  review: GenericNameReview;
  genericName: string;
  selectedSourceId: string;
}
interface ReviewResult { medicine_id: string; result: 'saved' | 'recorded' | 'changed' | 'already_filled' }

function dbClient() {
  if (!supabase) throw new Error('Database is unavailable');
  return supabase;
}
function databaseError(error: { message: string; code?: string; details?: string | null; hint?: string | null }) {
  if ((error.code === '22P02' && /dosage|enum/i.test(error.message)) || (error.code === '42883' && /btrim|dosage/i.test(error.message))) {
    return new Error(`The generic-name RPC needs its dosage-form enum fix. Apply 20261026180000_pharmacy_generic_name_cleanup.sql. [${error.code}] ${error.message}`);
  }
  if (['42P01', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    return new Error('Generic-name review needs the latest database migrations. Apply 20261026160000_pharmacy_generic_name_reviews.sql and 20261026180000_pharmacy_generic_name_cleanup.sql.');
  }
  return new Error([error.code ? `[${error.code}] ${error.message}` : error.message, error.details, error.hint].filter(Boolean).join(' — '));
}

export const genericNameService = {
  async getReviews(clinicId: string): Promise<GenericNameReview[]> {
    const rows: GenericNameReview[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await dbClient().from('medicine_generic_name_reviews').select('*').eq('clinic_id', clinicId)
        .order('medicine_id').range(offset, offset + 999);
      if (error) throw databaseError(error);
      rows.push(...(data ?? []) as GenericNameReview[]);
      if (!data || data.length < 1000) return rows;
    }
  },

  async lookup(medicines: MedicineMaster[]): Promise<{ errors: Array<{ name: string; message: string }> }> {
    if (!medicines.length || medicines.length > 10 || medicines.some(m => !genericNameReviewReason(m))) {
      throw new Error('Select up to 10 medicines with a missing generic name or a generic name copied from the brand.');
    }
    const { data: { session } } = await dbClient().auth.getSession();
    if (!session) throw new Error('Sign in again to look up generic names.');
    const response = await fetch(`${supabaseUrl}/functions/v1/lookup-generic-names`, {
      method: 'POST', signal: AbortSignal.timeout(150000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ medicineIds: medicines.map(medicine => medicine.id) }),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('Claude lookup is unavailable. Deploy the lookup-generic-names server function.'); }
    if (!response.ok || result.error) throw new Error(result.error || 'Claude lookup failed');
    return { errors: result.errors ?? [] };
  },

  async saveVerified(rows: SaveGenericName[]): Promise<ReviewResult[]> {
    if (!rows.length || rows.length > 10) throw new Error('Verify between 1 and 10 medicines at a time.');
    const { data, error } = await dbClient().rpc('pharmacy_generic_name_review', {
      p_action: 'save',
      p_rows: rows.map(row => ({ medicine_id: row.review.medicine_id, input_snapshot: row.review.input_snapshot,
        generic_name: row.genericName.trim(), selected_source_id: row.selectedSourceId || null, verified: true })),
    });
    if (error) throw databaseError(error);
    return data as ReviewResult[];
  },
};
