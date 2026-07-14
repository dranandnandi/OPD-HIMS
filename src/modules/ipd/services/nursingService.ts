import { supabase } from '../utils/supabase';
import type { Vitals, NursingNote, NursingTask, IntakeOutput } from '../types/ipd';

export interface VitalsInput {
  temperature?: number;
  pulse?: number;
  resp_rate?: number;
  bp_systolic?: number;
  bp_diastolic?: number;
  spo2?: number;
  pain_score?: number;
  blood_sugar?: number;
  weight_kg?: number;
}

export const nursingService = {
  // --- vitals ----------------------------------------------------------------
  async listVitals(admissionId: string, limit = 50): Promise<Vitals[]> {
    const { data, error } = await supabase
      .from('ipd_vitals')
      .select('*')
      .eq('admission_id', admissionId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as Vitals[];
  },

  async recordVitals(params: {
    clinicId: string;
    admissionId: string;
    vitals: VitalsInput;
    userId?: string;
  }): Promise<Vitals> {
    const { data, error } = await supabase
      .from('ipd_vitals')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        recorded_by: params.userId ?? null,
        ...params.vitals,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Vitals;
  },

  // --- notes -------------------------------------------------------------------
  async listNotes(admissionId: string, limit = 100): Promise<NursingNote[]> {
    const { data, error } = await supabase
      .from('ipd_nursing_notes')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as NursingNote[];
  },

  async addNote(params: {
    clinicId: string;
    admissionId: string;
    noteType: NursingNote['note_type'];
    note: string;
    userId?: string;
  }): Promise<NursingNote> {
    const { data, error } = await supabase
      .from('ipd_nursing_notes')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        note_type: params.noteType,
        note: params.note,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as NursingNote;
  },

  // --- tasks -------------------------------------------------------------------
  async listTasks(admissionId: string): Promise<NursingTask[]> {
    const { data, error } = await supabase
      .from('ipd_nursing_tasks')
      .select('*')
      .eq('admission_id', admissionId)
      .order('status', { ascending: true }) // pending first
      .order('due_at', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data as NursingTask[];
  },

  async addTask(params: {
    clinicId: string;
    admissionId: string;
    task: string;
    dueAt?: string;
    recurrence?: string;
    userId?: string;
  }): Promise<NursingTask> {
    const { data, error } = await supabase
      .from('ipd_nursing_tasks')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        task: params.task,
        due_at: params.dueAt ?? null,
        recurrence: params.recurrence ?? null,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as NursingTask;
  },

  async setTaskStatus(taskId: string, status: NursingTask['status'], userId?: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_nursing_tasks')
      .update({
        status,
        done_by: status === 'done' ? userId ?? null : null,
        done_at: status === 'done' ? new Date().toISOString() : null,
      })
      .eq('id', taskId);
    if (error) throw error;
  },

  // --- intake/output --------------------------------------------------------------
  async listIO(admissionId: string, limit = 100): Promise<IntakeOutput[]> {
    const { data, error } = await supabase
      .from('ipd_intake_output')
      .select('*')
      .eq('admission_id', admissionId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as IntakeOutput[];
  },

  async recordIO(params: {
    clinicId: string;
    admissionId: string;
    ioType: 'intake' | 'output';
    route: string;
    volumeMl: number;
    userId?: string;
  }): Promise<IntakeOutput> {
    const { data, error } = await supabase
      .from('ipd_intake_output')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        io_type: params.ioType,
        route: params.route,
        volume_ml: params.volumeMl,
        recorded_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as IntakeOutput;
  },
};
