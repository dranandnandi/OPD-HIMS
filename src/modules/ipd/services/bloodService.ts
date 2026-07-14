import { supabase } from '../utils/supabase';

export interface BloodRequest {
  id: string;
  clinic_id: string;
  admission_id: string;
  component: 'whole_blood' | 'prbc' | 'ffp' | 'platelets' | 'cryoprecipitate';
  blood_group: string | null;
  units: number;
  urgency: 'routine' | 'urgent' | 'emergency';
  indication: string | null;
  status: 'requested' | 'received' | 'cross_checked' | 'transfused' | 'cancelled';
  requested_by: string | null;
  requested_at: string;
  received_by: string | null;
  received_at: string | null;
  bag_number: string | null;
  blood_bank: string | null;
  checked_by: string | null;
  checked_at: string | null;
  transfused_by: string | null;
  witnessed_by: string | null;
  transfused_at: string | null;
  reaction: boolean;
  reaction_notes: string | null;
  cancelled_reason: string | null;
  // joined
  requester?: { name: string | null } | null;
  receiver?: { name: string | null } | null;
  checker?: { name: string | null } | null;
  transfuser?: { name: string | null } | null;
  witness?: { name: string | null } | null;
}

export const BLOOD_COMPONENTS = [
  { value: 'prbc', label: 'PRBC (packed cells)' },
  { value: 'whole_blood', label: 'Whole blood' },
  { value: 'ffp', label: 'FFP (plasma)' },
  { value: 'platelets', label: 'Platelets' },
  { value: 'cryoprecipitate', label: 'Cryoprecipitate' },
];

const REQUEST_SELECT = `*,
  requester:profiles!ipd_blood_requests_requested_by_fkey(name),
  receiver:profiles!ipd_blood_requests_received_by_fkey(name),
  checker:profiles!ipd_blood_requests_checked_by_fkey(name),
  transfuser:profiles!ipd_blood_requests_transfused_by_fkey(name),
  witness:profiles!ipd_blood_requests_witnessed_by_fkey(name)`;

async function logEvent(
  clinicId: string, requestId: string, event: string, actorId?: string,
  details: Record<string, unknown> = {}
) {
  await supabase.from('ipd_blood_events').insert({
    clinic_id: clinicId, request_id: requestId, event,
    actor_id: actorId ?? null, details,
  });
}

export const bloodService = {
  async listRequests(admissionId: string): Promise<BloodRequest[]> {
    const { data, error } = await supabase
      .from('ipd_blood_requests')
      .select(REQUEST_SELECT)
      .eq('admission_id', admissionId)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return data as unknown as BloodRequest[];
  },

  /** Step 1 — demand raised */
  async createRequest(params: {
    clinicId: string;
    admissionId: string;
    component: BloodRequest['component'];
    bloodGroup?: string;
    units: number;
    urgency: BloodRequest['urgency'];
    indication?: string;
    userId?: string;
  }): Promise<BloodRequest> {
    const { data, error } = await supabase
      .from('ipd_blood_requests')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        component: params.component,
        blood_group: params.bloodGroup ?? null,
        units: params.units,
        urgency: params.urgency,
        indication: params.indication ?? null,
        requested_by: params.userId ?? null,
      })
      .select(REQUEST_SELECT)
      .single();
    if (error) throw error;
    await logEvent(params.clinicId, data.id, 'requested', params.userId, {
      component: params.component, units: params.units, urgency: params.urgency,
    });
    return data as unknown as BloodRequest;
  },

  /** Step 2 — bag arrived on the ward from the blood bank */
  async markReceived(params: {
    request: BloodRequest;
    bagNumber: string;
    bloodBank?: string;
    userId?: string;
  }): Promise<void> {
    const { error } = await supabase
      .from('ipd_blood_requests')
      .update({
        status: 'received',
        received_by: params.userId ?? null,
        received_at: new Date().toISOString(),
        bag_number: params.bagNumber,
        blood_bank: params.bloodBank ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.request.id)
      .eq('status', 'requested');
    if (error) throw error;
    await logEvent(params.request.clinic_id, params.request.id, 'received', params.userId, {
      bag_number: params.bagNumber, blood_bank: params.bloodBank ?? null,
    });
  },

  /** Step 3 — bedside check: bag vs patient identity/group verified */
  async markChecked(params: { request: BloodRequest; userId?: string }): Promise<void> {
    const { error } = await supabase
      .from('ipd_blood_requests')
      .update({
        status: 'cross_checked',
        checked_by: params.userId ?? null,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.request.id)
      .eq('status', 'received');
    if (error) throw error;
    await logEvent(params.request.clinic_id, params.request.id, 'cross_checked', params.userId);
  },

  /** Step 4 — transfused; giver signs, witness countersigns */
  async markTransfused(params: {
    request: BloodRequest;
    witnessedById?: string;
    reaction?: boolean;
    reactionNotes?: string;
    userId?: string;
  }): Promise<void> {
    const { error } = await supabase
      .from('ipd_blood_requests')
      .update({
        status: 'transfused',
        transfused_by: params.userId ?? null,
        witnessed_by: params.witnessedById ?? null,
        transfused_at: new Date().toISOString(),
        reaction: params.reaction ?? false,
        reaction_notes: params.reactionNotes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.request.id)
      .eq('status', 'cross_checked');
    if (error) throw error;
    await logEvent(params.request.clinic_id, params.request.id, 'transfused', params.userId, {
      witnessed_by: params.witnessedById ?? null, reaction: params.reaction ?? false,
    });
  },

  async cancel(params: { request: BloodRequest; reason: string; userId?: string }): Promise<void> {
    const { error } = await supabase
      .from('ipd_blood_requests')
      .update({
        status: 'cancelled',
        cancelled_reason: params.reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.request.id)
      .in('status', ['requested', 'received', 'cross_checked']);
    if (error) throw error;
    await logEvent(params.request.clinic_id, params.request.id, 'cancelled', params.userId, {
      reason: params.reason,
    });
  },
};
