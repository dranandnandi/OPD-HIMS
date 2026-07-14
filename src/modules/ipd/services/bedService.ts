import { supabase } from '../utils/supabase';
import type { Bed, BedType, Ward, BedAllocation } from '../types/ipd';

export const bedService = {
  async listWards(clinicId: string): Promise<Ward[]> {
    const { data, error } = await supabase
      .from('ipd_wards')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data as Ward[];
  },

  async listBedTypes(clinicId: string): Promise<BedType[]> {
    const { data, error } = await supabase
      .from('bed_types')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data as BedType[];
  },

  /** Full bed board: beds with ward + type joined */
  async listBeds(clinicId: string, wardId?: string): Promise<Bed[]> {
    let query = supabase
      .from('ipd_beds')
      .select('*, ward:ipd_wards(*), bed_type:bed_types(*)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('bed_number');
    if (wardId) query = query.eq('ward_id', wardId);
    const { data, error } = await query;
    if (error) throw error;
    return data as Bed[];
  },

  async setBedStatus(bedId: string, status: Bed['status'], note?: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_beds')
      .update({ status, status_note: note ?? null, updated_at: new Date().toISOString() })
      .eq('id', bedId);
    if (error) throw error;
  },

  /** Transfer: close open allocation, open a new one (trigger syncs bed statuses) */
  async transferBed(params: {
    clinicId: string;
    admissionId: string;
    toBedId: string;
    reason: BedAllocation['reason'];
    rateSnapshot?: number;
    notes?: string;
    userId?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error: closeErr } = await supabase
      .from('ipd_bed_allocations')
      .update({ to_datetime: now })
      .eq('admission_id', params.admissionId)
      .is('to_datetime', null);
    if (closeErr) throw closeErr;

    const { error: openErr } = await supabase.from('ipd_bed_allocations').insert({
      clinic_id: params.clinicId,
      admission_id: params.admissionId,
      bed_id: params.toBedId,
      from_datetime: now,
      reason: params.reason,
      rate_snapshot: params.rateSnapshot ?? null,
      notes: params.notes ?? null,
      created_by: params.userId ?? null,
    });
    if (openErr) throw openErr;
  },
};
