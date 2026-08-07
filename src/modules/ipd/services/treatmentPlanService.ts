import { supabase } from '../utils/supabase';
import { chargeService } from './chargeService';
import type { IpdConsultation, TreatmentPlan } from '../types/ipd';

/** Date-wise doctor treatment plan — its own note stream, deliberately not a
    nursing note. Orders, medicines, diet and cross consultations raised on a
    round carry treatment_plan_id back to the entry that asked for them. */

export interface TreatmentPlanInput {
  planDate?: string;          // yyyy-MM-dd, defaults to today
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  advice?: string | null;
  voiceTranscript?: string | null;
  doctorId?: string | null;
}

const hasContent = (p: TreatmentPlanInput) =>
  [p.subjective, p.objective, p.assessment, p.plan, p.advice].some((v) => v && v.trim());

export const treatmentPlanService = {
  async list(admissionId: string): Promise<TreatmentPlan[]> {
    const { data, error } = await supabase
      .from('ipd_treatment_plans')
      .select('*, doctor:profiles!ipd_treatment_plans_doctor_id_fkey(id, name)')
      .eq('admission_id', admissionId)
      .order('plan_date', { ascending: false })
      .order('recorded_at', { ascending: false });
    if (error) throw error;
    return data as unknown as TreatmentPlan[];
  },

  /** Most recent entry — used to pre-fill "continue same plan" and as voice context */
  async latest(admissionId: string): Promise<TreatmentPlan | null> {
    const { data, error } = await supabase
      .from('ipd_treatment_plans')
      .select('*')
      .eq('admission_id', admissionId)
      .order('plan_date', { ascending: false })
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as TreatmentPlan) ?? null;
  },

  async create(params: {
    clinicId: string;
    admissionId: string;
    userId?: string;
    input: TreatmentPlanInput;
  }): Promise<TreatmentPlan> {
    const { input } = params;
    if (!hasContent(input)) throw new Error('Write at least one part of the plan');

    const { data, error } = await supabase
      .from('ipd_treatment_plans')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        plan_date: input.planDate ?? new Date().toISOString().slice(0, 10),
        doctor_id: input.doctorId ?? params.userId ?? null,
        subjective: input.subjective ?? null,
        objective: input.objective ?? null,
        assessment: input.assessment ?? null,
        plan: input.plan ?? null,
        advice: input.advice ?? null,
        voice_transcript: input.voiceTranscript ?? null,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as TreatmentPlan;
  },

  async update(planId: string, input: TreatmentPlanInput): Promise<void> {
    const { error } = await supabase
      .from('ipd_treatment_plans')
      .update({
        plan_date: input.planDate,
        subjective: input.subjective ?? null,
        objective: input.objective ?? null,
        assessment: input.assessment ?? null,
        plan: input.plan ?? null,
        advice: input.advice ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId);
    if (error) throw error;
  },

  async remove(planId: string): Promise<void> {
    const { error } = await supabase.from('ipd_treatment_plans').delete().eq('id', planId);
    if (error) throw error;
  },

  // --- cross consultation ----------------------------------------------------

  async listConsultations(admissionId: string): Promise<IpdConsultation[]> {
    const { data, error } = await supabase
      .from('ipd_consultations')
      .select('*, doctor:profiles!ipd_consultations_doctor_id_fkey(id, name)')
      .eq('admission_id', admissionId)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return data as unknown as IpdConsultation[];
  },

  async requestConsultation(params: {
    clinicId: string;
    admissionId: string;
    treatmentPlanId?: string | null;
    specialty?: string | null;
    doctorId?: string | null;
    externalDoctorName?: string | null;
    reason: string;
    urgency?: IpdConsultation['urgency'];
    userId?: string;
  }): Promise<IpdConsultation> {
    if (!params.reason.trim()) throw new Error('Reason for consultation is required');
    const { data, error } = await supabase
      .from('ipd_consultations')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        treatment_plan_id: params.treatmentPlanId ?? null,
        specialty: params.specialty ?? null,
        doctor_id: params.doctorId ?? null,
        external_doctor_name: params.externalDoctorName ?? null,
        reason: params.reason.trim(),
        urgency: params.urgency ?? 'routine',
        requested_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as IpdConsultation;
  },

  /** Billable service for a cross consultation — seeded as CONS-CROSS */
  async getConsultationService(
    clinicId: string
  ): Promise<{ id: string; name: string; base_price: number } | null> {
    const { data: preferred } = await supabase
      .from('services_master')
      .select('id, name, base_price')
      .eq('clinic_id', clinicId)
      .eq('service_code', 'CONS-CROSS')
      .eq('is_active', true)
      .maybeSingle();
    if (preferred) return preferred as { id: string; name: string; base_price: number };

    const { data } = await supabase
      .from('services_master')
      .select('id, name, base_price')
      .eq('clinic_id', clinicId)
      .eq('service_type', 'consultation')
      .eq('is_active', true)
      .order('base_price', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string; name: string; base_price: number }) ?? null;
  },

  /**
   * Record the consultant's opinion. The visit is billed HERE rather than at
   * request time — a request that is never attended, or is cancelled, must not
   * reach the patient's bill. Package coverage is applied by the charge_postings
   * trigger, so a package-covered consult still posts but bills at ₹0.
   */
  async recordOpinion(params: {
    consultationId: string;
    opinion: string;
    userId?: string;
    /** consultant who saw the patient — attributed on the bill line */
    doctorId?: string | null;
    billing?: {
      clinicId: string;
      admissionId: string;
      serviceId: string;
      unitRate: number;
      description?: string;
    };
  }): Promise<void> {
    let chargePostingId: string | null = null;

    if (params.billing && params.billing.unitRate >= 0) {
      const posting = await chargeService.postCharge({
        clinicId: params.billing.clinicId,
        admissionId: params.billing.admissionId,
        serviceId: params.billing.serviceId,
        quantity: 1,
        unitRate: params.billing.unitRate,
        source: 'order',
        sourceRef: params.consultationId,
        description: params.billing.description,
        orderingDoctorId: params.userId,
        performingDoctorId: params.doctorId ?? undefined,
        userId: params.userId,
      });
      chargePostingId = posting.id;
    }

    const { error } = await supabase
      .from('ipd_consultations')
      .update({
        opinion: params.opinion,
        status: 'seen',
        seen_by: params.userId ?? null,
        seen_at: new Date().toISOString(),
        ...(params.doctorId ? { doctor_id: params.doctorId } : {}),
        ...(chargePostingId ? { charge_posting_id: chargePostingId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.consultationId);
    if (error) throw error;
  },

  async cancelConsultation(consultationId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_consultations')
      .update({
        status: 'cancelled',
        cancelled_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', consultationId);
    if (error) throw error;
  },
};
