import { supabase } from '../utils/supabase';

export interface InsuranceDetails {
  id: string;
  clinic_id: string;
  admission_id: string;
  payer_id: string | null;
  insurer_name: string | null;
  tpa_name: string | null;
  policy_number: string | null;
  member_id: string | null;
  sum_insured: number;
  co_pay_percent: number;
  room_rent_cap: number | null;
  is_corporate: boolean;
  policy_valid_till: string | null;
  notes: string | null;
}

export interface Preauth {
  id: string;
  clinic_id: string;
  admission_id: string;
  preauth_type: 'initial' | 'enhancement';
  requested_amount: number;
  requested_at: string;
  status: 'requested' | 'queried' | 'approved' | 'partial' | 'rejected';
  approved_amount: number | null;
  approval_ref: string | null;
  approved_at: string | null;
  remarks: string | null;
}

export interface ClaimDeduction {
  id: string;
  clinic_id: string;
  claim_id: string;
  category: 'non_payable' | 'consumable' | 'excess' | 'policy_exclusion' | 'documentation' | 'other';
  amount: number;
  reason: string | null;
  borne_by: 'patient' | 'hospital';
}

export interface Claim {
  id: string;
  clinic_id: string;
  admission_id: string;
  bill_id: string | null;
  claim_number: string | null;
  claimed_amount: number;
  status: 'draft' | 'submitted' | 'queried' | 'approved' | 'settled' | 'rejected';
  approved_amount: number;
  received_amount: number;
  deducted_amount: number;
  submitted_at: string | null;
  settled_at: string | null;
  remarks: string | null;
}

export interface PayerOption {
  id: string;
  name: string;
  payer_type: string;
}

export interface ClaimWorklistRow extends Claim {
  admission_number: string;
  patient_name: string;
}

export const insuranceService = {
  async listPayers(clinicId: string): Promise<PayerOption[]> {
    const { data, error } = await supabase
      .from('payers')
      .select('id, name, payer_type')
      .eq('clinic_id', clinicId)
      .order('name');
    if (error) throw error;
    return (data ?? []) as PayerOption[];
  },

  // --- insurance details -----------------------------------------------------
  async getInsurance(admissionId: string): Promise<InsuranceDetails | null> {
    const { data, error } = await supabase
      .from('ipd_insurance_details')
      .select('*')
      .eq('admission_id', admissionId)
      .maybeSingle();
    if (error) throw error;
    return (data as InsuranceDetails) ?? null;
  },

  async upsertInsurance(params: {
    clinicId: string;
    admissionId: string;
    userId?: string;
    values: Partial<Omit<InsuranceDetails, 'id' | 'clinic_id' | 'admission_id'>>;
  }): Promise<InsuranceDetails> {
    const { data, error } = await supabase
      .from('ipd_insurance_details')
      .upsert(
        {
          clinic_id: params.clinicId,
          admission_id: params.admissionId,
          created_by: params.userId ?? null,
          updated_at: new Date().toISOString(),
          ...params.values,
        },
        { onConflict: 'admission_id' }
      )
      .select()
      .single();
    if (error) throw error;
    return data as InsuranceDetails;
  },

  // --- pre-authorizations ----------------------------------------------------
  async listPreauths(admissionId: string): Promise<Preauth[]> {
    const { data, error } = await supabase
      .from('ipd_preauths')
      .select('*')
      .eq('admission_id', admissionId)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Preauth[];
  },

  async createPreauth(params: {
    clinicId: string;
    admissionId: string;
    userId?: string;
    preauthType: 'initial' | 'enhancement';
    requestedAmount: number;
    remarks?: string;
  }): Promise<void> {
    const { error } = await supabase.from('ipd_preauths').insert({
      clinic_id: params.clinicId,
      admission_id: params.admissionId,
      preauth_type: params.preauthType,
      requested_amount: params.requestedAmount,
      remarks: params.remarks ?? null,
      created_by: params.userId ?? null,
    });
    if (error) throw error;
  },

  async updatePreauth(id: string, patch: Partial<Preauth>): Promise<void> {
    const { error } = await supabase
      .from('ipd_preauths')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // --- claims ----------------------------------------------------------------
  async listClaims(admissionId: string): Promise<Claim[]> {
    const { data, error } = await supabase
      .from('ipd_claims')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Claim[];
  },

  async createClaim(params: {
    clinicId: string;
    admissionId: string;
    userId?: string;
    claimedAmount: number;
    claimNumber?: string;
    billId?: string | null;
  }): Promise<Claim> {
    const { data, error } = await supabase
      .from('ipd_claims')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        claimed_amount: params.claimedAmount,
        claim_number: params.claimNumber ?? null,
        bill_id: params.billId ?? null,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Claim;
  },

  async updateClaim(id: string, patch: Partial<Claim>): Promise<void> {
    const { error } = await supabase
      .from('ipd_claims')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // --- deductions ------------------------------------------------------------
  async listDeductions(claimId: string): Promise<ClaimDeduction[]> {
    const { data, error } = await supabase
      .from('ipd_claim_deductions')
      .select('*')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ClaimDeduction[];
  },

  async addDeduction(params: {
    clinicId: string;
    claimId: string;
    category: ClaimDeduction['category'];
    amount: number;
    reason?: string;
    borneBy: 'patient' | 'hospital';
    userId?: string;
  }): Promise<void> {
    const { error } = await supabase.from('ipd_claim_deductions').insert({
      clinic_id: params.clinicId,
      claim_id: params.claimId,
      category: params.category,
      amount: params.amount,
      reason: params.reason ?? null,
      borne_by: params.borneBy,
      created_by: params.userId ?? null,
    });
    if (error) throw error;
  },

  async deleteDeduction(id: string): Promise<void> {
    const { error } = await supabase.from('ipd_claim_deductions').delete().eq('id', id);
    if (error) throw error;
  },

  /** Roll the claim's deducted_amount up from its deduction lines. */
  async recomputeClaimDeductions(claimId: string): Promise<void> {
    const { data } = await supabase
      .from('ipd_claim_deductions')
      .select('amount')
      .eq('claim_id', claimId);
    const total = (data ?? []).reduce((s, d) => s + Number((d as { amount: number }).amount), 0);
    await supabase
      .from('ipd_claims')
      .update({ deducted_amount: total, updated_at: new Date().toISOString() })
      .eq('id', claimId);
  },

  // --- cross-admission worklist (TPA desk) -----------------------------------
  async getClaimsWorklist(clinicId: string): Promise<ClaimWorklistRow[]> {
    const { data, error } = await supabase
      .from('ipd_claims')
      .select('*, admission:ipd_admissions(admission_number, patient:patients(name))')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as Array<Claim & {
      admission?: { admission_number?: string; patient?: { name?: string } | null } | null;
    }>).map((c) => ({
      ...c,
      admission_number: c.admission?.admission_number ?? '',
      patient_name: c.admission?.patient?.name ?? '',
    }));
  },
};
