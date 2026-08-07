import { supabase } from '../utils/supabase';
import type { Admission, AdmissionType, BedAllocation, DischargeChecklist } from '../types/ipd';

export interface MlcDetails {
  id?: string;
  clinic_id?: string;
  admission_id?: string;
  incident_datetime: string | null;
  incident_place: string | null;
  incident_description: string | null;
  brought_by: string | null;
  injuries_description: string | null;
  alcohol_suspected: boolean;
  police_station: string | null;
  fir_number: string | null;
  police_informed_at: string | null;
  informed_officer: string | null;
  belongings: string | null;
  identification_marks: string | null;
}

export interface CreateAdmissionInput {
  clinicId: string;
  patientId: string;
  admittingDoctorId: string;
  bedId: string;
  admissionType: AdmissionType;
  provisionalDiagnosis?: string;
  reasonForAdmission?: string;
  payerId?: string;
  tariffPlanId?: string;
  estimatedCost?: number;
  estimatedStayDays?: number;
  isMlc?: boolean;
  mlcNumber?: string;
  attendantName?: string;
  attendantPhone?: string;
  attendantRelation?: string;
  sourceVisitId?: string;
  userId?: string;
}

/** What has already been recorded against an admission — decides whether it can
    be cancelled (voided) or permanently deleted. */
export interface AdmissionActivity {
  charges: number;      // live (non-cancelled) charge postings
  bills: number;        // live (non-cancelled) bills
  deposits: number;     // deposit / refund / applied entries
  depositsHeld: number; // net advance still with the clinic
  orders: number;
  medications: number;
  nursing: number;      // vitals + nursing notes
  documents: number;
  claims: number;       // TPA pre-auths + claims
  /** money has moved — cancel is blocked until it is reversed */
  hasFinancials: boolean;
  /** nothing at all recorded — safe to delete the record outright */
  isEmpty: boolean;
}

export const admissionService = {
  /** Active census with patient + bed joined */
  async listActive(clinicId: string): Promise<Admission[]> {
    const { data, error } = await supabase
      .from('ipd_admissions')
      .select(
        `*,
         patient:patients(id, name, phone, age, gender, blood_group, allergies, abha_number, clinic_id),
         admitting_doctor:profiles!ipd_admissions_admitting_doctor_id_fkey(id, name, email, role_name, specialization, permissions, is_active, clinic_id),
         current_bed:ipd_beds(*, ward:ipd_wards(*), bed_type:bed_types(*))`
      )
      .eq('clinic_id', clinicId)
      .eq('status', 'admitted')
      .order('admission_datetime', { ascending: false });
    if (error) throw error;
    return data as unknown as Admission[];
  },

  /** Past patients: discharged / DAMA / expired / transferred, newest first */
  async listPast(clinicId: string, limit = 100): Promise<Admission[]> {
    const { data, error } = await supabase
      .from('ipd_admissions')
      .select(
        `*,
         patient:patients(id, name, phone, age, gender, blood_group, allergies, abha_number, clinic_id),
         admitting_doctor:profiles!ipd_admissions_admitting_doctor_id_fkey(id, name, email, role_name, specialization, permissions, is_active, clinic_id)`
      )
      .eq('clinic_id', clinicId)
      .in('status', ['discharged', 'dama', 'expired', 'transferred_out', 'cancelled'])
      .order('discharge_datetime', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as Admission[];
  },

  async getById(admissionId: string): Promise<Admission | null> {
    const { data, error } = await supabase
      .from('ipd_admissions')
      .select(
        `*,
         patient:patients(id, name, phone, age, gender, blood_group, allergies, abha_number, clinic_id),
         admitting_doctor:profiles!ipd_admissions_admitting_doctor_id_fkey(id, name, email, role_name, specialization, permissions, is_active, clinic_id),
         current_bed:ipd_beds(*, ward:ipd_wards(*), bed_type:bed_types(*))`
      )
      .eq('id', admissionId)
      .maybeSingle();
    if (error) throw error;
    return data as unknown as Admission | null;
  },

  /** Create admission + first bed allocation. Admission number comes from the DB sequence. */
  async create(input: CreateAdmissionInput): Promise<Admission> {
    const { data: numberData, error: numberErr } = await supabase.rpc('next_document_number', {
      p_clinic_id: input.clinicId,
      p_doc_type: 'admission',
    });
    if (numberErr) throw numberErr;

    const { data: admission, error: admErr } = await supabase
      .from('ipd_admissions')
      .insert({
        clinic_id: input.clinicId,
        admission_number: numberData as string,
        patient_id: input.patientId,
        admitting_doctor_id: input.admittingDoctorId,
        admission_type: input.admissionType,
        provisional_diagnosis: input.provisionalDiagnosis ?? null,
        reason_for_admission: input.reasonForAdmission ?? null,
        payer_id: input.payerId ?? null,
        tariff_plan_id: input.tariffPlanId ?? null,
        estimated_cost: input.estimatedCost ?? null,
        estimated_stay_days: input.estimatedStayDays ?? null,
        is_mlc: input.isMlc ?? false,
        mlc_number: input.mlcNumber ?? null,
        attendant_name: input.attendantName ?? null,
        attendant_phone: input.attendantPhone ?? null,
        attendant_relation: input.attendantRelation ?? null,
        source_visit_id: input.sourceVisitId ?? null,
        created_by: input.userId ?? null,
      })
      .select()
      .single();
    if (admErr) throw admErr;

    const { error: allocErr } = await supabase.from('ipd_bed_allocations').insert({
      clinic_id: input.clinicId,
      admission_id: admission.id,
      bed_id: input.bedId,
      reason: 'admission',
      created_by: input.userId ?? null,
    });
    if (allocErr) throw allocErr;

    return admission as Admission;
  },

  async listBedHistory(admissionId: string): Promise<BedAllocation[]> {
    const { data, error } = await supabase
      .from('ipd_bed_allocations')
      .select('*, bed:ipd_beds(*, ward:ipd_wards(*), bed_type:bed_types(*)), creator:profiles(name)')
      .eq('admission_id', admissionId)
      .order('from_datetime');
    if (error) throw error;
    return data as unknown as BedAllocation[];
  },

  // --- MLC register -----------------------------------------------------------
  async getMlcDetails(admissionId: string): Promise<MlcDetails | null> {
    const { data, error } = await supabase
      .from('ipd_mlc_details')
      .select('*')
      .eq('admission_id', admissionId)
      .maybeSingle();
    if (error) throw error;
    return data as MlcDetails | null;
  },

  async upsertMlcDetails(params: {
    clinicId: string;
    admissionId: string;
    patch: Partial<MlcDetails>;
    userId?: string;
  }): Promise<MlcDetails> {
    const { data, error } = await supabase
      .from('ipd_mlc_details')
      .upsert(
        {
          clinic_id: params.clinicId,
          admission_id: params.admissionId,
          ...params.patch,
          created_by: params.userId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'admission_id' }
      )
      .select()
      .single();
    if (error) throw error;
    return data as MlcDetails;
  },

  async getChecklist(admissionId: string): Promise<DischargeChecklist | null> {
    const { data, error } = await supabase
      .from('ipd_discharge_checklist')
      .select('*')
      .eq('admission_id', admissionId)
      .maybeSingle();
    if (error) throw error;
    return data as DischargeChecklist | null;
  },

  /** Create-or-update the discharge checklist for an admission */
  async upsertChecklist(params: {
    clinicId: string;
    admissionId: string;
    patch: Partial<Pick<DischargeChecklist,
      'bill_cleared' | 'summary_signed' | 'meds_reconciled' | 'implants_documented' | 'followup_booked'>>;
  }): Promise<DischargeChecklist> {
    const { data, error } = await supabase
      .from('ipd_discharge_checklist')
      .upsert(
        {
          clinic_id: params.clinicId,
          admission_id: params.admissionId,
          ...params.patch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'admission_id' }
      )
      .select()
      .single();
    if (error) throw error;
    return data as DischargeChecklist;
  },

  /** Discharge: close open bed allocation and set admission status */
  async discharge(params: {
    admissionId: string;
    dischargeType: NonNullable<Admission['discharge_type']>;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error: allocErr } = await supabase
      .from('ipd_bed_allocations')
      .update({ to_datetime: now })
      .eq('admission_id', params.admissionId)
      .is('to_datetime', null);
    if (allocErr) throw allocErr;

    const { error } = await supabase
      .from('ipd_admissions')
      .update({
        status: params.dischargeType === 'expired' ? 'expired'
          : params.dischargeType === 'dama' ? 'dama' : 'discharged',
        discharge_datetime: now,
        discharge_type: params.dischargeType,
        current_bed_id: null,
        updated_at: now,
      })
      .eq('id', params.admissionId);
    if (error) throw error;
  },

  // --- Cancel / delete a wrongly-created admission ----------------------------

  /** Count everything already recorded against the admission (head-only counts) */
  async getActivity(admissionId: string): Promise<AdmissionActivity> {
    const count = async (table: string, liveOnly = false) => {
      let q = supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('admission_id', admissionId);
      if (liveOnly) q = q.neq('status', 'cancelled');
      const { count: c, error } = await q;
      if (error) throw error;
      return c ?? 0;
    };

    const depositLedger = async () => {
      const { data, error } = await supabase
        .from('ipd_deposits')
        .select('amount, entry_type')
        .eq('admission_id', admissionId);
      if (error) throw error;
      const rows = data ?? [];
      return {
        entries: rows.length,
        // same sign convention as the billing overview: refunds/applications reduce the balance
        held: rows.reduce(
          (s, d) => s + (d.entry_type === 'deposit' ? Number(d.amount) : -Number(d.amount)), 0
        ),
      };
    };

    const [
      charges, bills, deposit, orders, medications,
      vitals, notes, documents, packages, policy, preauths, claims,
    ] = await Promise.all([
      count('charge_postings', true),
      count('ipd_bills', true),
      depositLedger(),
      count('ipd_orders'),
      count('ipd_medication_orders'),
      count('ipd_vitals'),
      count('ipd_nursing_notes'),
      count('ipd_documents'),
      count('admission_packages'),
      count('ipd_insurance_details'),
      count('ipd_preauths'),
      count('ipd_claims'),
    ]);

    const nursing = vitals + notes;
    const insurance = policy + preauths + claims;
    return {
      charges, bills, orders, medications, nursing, documents,
      deposits: deposit.entries,
      depositsHeld: deposit.held,
      claims: insurance,
      hasFinancials: bills > 0 || deposit.held > 0,
      isEmpty:
        charges + bills + deposit.entries + orders + medications +
        nursing + documents + packages + insurance === 0,
    };
  },

  /** Free the bed(s) held by a voided admission. Allocation rows are removed
      rather than closed — the stay never happened, so there is no history worth
      keeping and the bed goes straight back on the board (not to 'cleaning'). */
  async releaseBeds(admissionId: string): Promise<void> {
    const { data: allocations, error: readErr } = await supabase
      .from('ipd_bed_allocations')
      .select('bed_id')
      .eq('admission_id', admissionId);
    if (readErr) throw readErr;

    const bedIds = [...new Set((allocations ?? []).map((a) => a.bed_id))];
    if (bedIds.length === 0) return;

    const { error: delErr } = await supabase
      .from('ipd_bed_allocations')
      .delete()
      .eq('admission_id', admissionId);
    if (delErr) throw delErr;

    // DELETE does not fire the allocation→bed trigger, so free the beds here
    const { error: bedErr } = await supabase
      .from('ipd_beds')
      .update({ status: 'available', status_note: null, updated_at: new Date().toISOString() })
      .in('id', bedIds)
      .eq('status', 'occupied');
    if (bedErr) throw bedErr;
  },

  /** Void a wrongly-created admission: frees the bed, cancels unbilled charges
      and keeps the record with status 'cancelled' (audit trail preserved). */
  async cancel(params: {
    admissionId: string;
    reason: string;
    userId?: string;
    userName?: string;
  }): Promise<void> {
    const { data: current, error: readErr } = await supabase
      .from('ipd_admissions')
      .select('notes, status')
      .eq('id', params.admissionId)
      .single();
    if (readErr) throw readErr;
    if (current.status !== 'admitted') {
      throw new Error(`Admission is already ${current.status} — nothing to cancel.`);
    }

    const activity = await admissionService.getActivity(params.admissionId);
    if (activity.hasFinancials) {
      throw new Error(
        'Bills or deposits exist for this admission — cancel the bills and refund the deposits first, then discharge instead.'
      );
    }

    const now = new Date().toISOString();

    // unbilled charges auto-posted at admission (room rent, admission fee…) are voided
    const { error: chargeErr } = await supabase
      .from('charge_postings')
      .update({ status: 'cancelled', updated_at: now })
      .eq('admission_id', params.admissionId)
      .eq('status', 'pending');
    if (chargeErr) throw chargeErr;

    await admissionService.releaseBeds(params.admissionId);

    const stamp = `[Admission cancelled ${new Date().toLocaleString('en-IN')}${
      params.userName ? ` by ${params.userName}` : ''
    }] ${params.reason}`;

    const { error } = await supabase
      .from('ipd_admissions')
      .update({
        status: 'cancelled',
        discharge_datetime: now,
        discharge_type: null,
        current_bed_id: null,
        notes: current.notes ? `${current.notes}\n${stamp}` : stamp,
        updated_at: now,
      })
      .eq('id', params.admissionId)
      .eq('status', 'admitted');
    if (error) throw error;
  },

  /** Permanently remove an admission created by mistake. Only allowed while
      nothing is recorded against it — the patient record itself is untouched. */
  async deleteAdmission(admissionId: string): Promise<void> {
    const activity = await admissionService.getActivity(admissionId);
    if (!activity.isEmpty) {
      throw new Error(
        'This admission already has charges, orders or notes recorded — cancel it instead of deleting.'
      );
    }

    await admissionService.releaseBeds(admissionId);

    // the discharge checklist and any remaining child rows cascade
    const { error } = await supabase.from('ipd_admissions').delete().eq('id', admissionId);
    if (error) throw error;
  },
};
