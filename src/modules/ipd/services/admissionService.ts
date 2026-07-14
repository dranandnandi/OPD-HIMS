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
      .in('status', ['discharged', 'dama', 'expired', 'transferred_out'])
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
};
