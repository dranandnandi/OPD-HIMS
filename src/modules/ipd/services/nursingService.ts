import { supabase } from '../utils/supabase';
import type {
  Vitals, NursingNote, NursingTask, IntakeOutput, ChartAmendment,
} from '../types/ipd';

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

/** The three tables the ward chart is made of — see amendChartRow below */
export type ChartTable = ChartAmendment['source_table'];

/**
 * Sent as recorded_at / created_at: the time the reading was TAKEN, which is
 * not always the time it is keyed in. Left undefined the database stamps now(),
 * which is right for charting at the bedside. Backdating is allowed (and is
 * the honest thing on a late entry); the database rejects a future time and
 * separately records charted_at, so a late entry prints as one.
 */
const clinicalTime = (at?: string): Record<string, string> =>
  at ? { recorded_at: at } : {};

export const nursingService = {
  // --- vitals ----------------------------------------------------------------
  async listVitals(admissionId: string, limit = 50): Promise<Vitals[]> {
    const { data, error } = await supabase
      .from('ipd_vitals')
      .select('*, recorder:profiles!ipd_vitals_recorded_by_fkey(id, name)')
      .eq('admission_id', admissionId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as Vitals[];
  },

  async recordVitals(params: {
    clinicId: string;
    admissionId: string;
    vitals: VitalsInput;
    /** ISO time the reading was taken; omit for "now" */
    recordedAt?: string;
    userId?: string;
  }): Promise<Vitals> {
    const { data, error } = await supabase
      .from('ipd_vitals')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        recorded_by: params.userId ?? null,
        ...clinicalTime(params.recordedAt),
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
      .select('*, author:profiles!ipd_nursing_notes_created_by_fkey(id, name)')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as NursingNote[];
  },

  async addNote(params: {
    clinicId: string;
    admissionId: string;
    noteType: NursingNote['note_type'];
    note: string;
    /** ISO time the observation was made; omit for "now" */
    observedAt?: string;
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
        // created_at IS the clinical time on a note; charted_at records entry
        ...(params.observedAt ? { created_at: params.observedAt } : {}),
      })
      .select()
      .single();
    if (error) throw error;
    return data as NursingNote;
  },

  // --- tasks -------------------------------------------------------------------
  /**
   * Pending work first, then what has already been dealt with.
   *
   * Ordering by the status column alone put 'done' ahead of 'pending'
   * alphabetically — harmless with a handful of ad-hoc tasks, wrong once a
   * 30-minute monitoring order is expanding occurrences all day. The rank is
   * therefore applied here, not in SQL.
   */
  async listTasks(admissionId: string, limit = 400): Promise<NursingTask[]> {
    const { data, error } = await supabase
      .from('ipd_nursing_tasks')
      .select('*')
      .eq('admission_id', admissionId)
      .order('due_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    const rank = (t: NursingTask) => (t.status === 'pending' ? 0 : 1);
    const due = (t: NursingTask) => (t.due_at ? new Date(t.due_at).getTime() : 0);
    return (data as NursingTask[]).sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      // pending: soonest first (what to do next). settled: most recent first.
      return rank(a) === 0 ? due(a) - due(b) : due(b) - due(a);
    });
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
      .select('*, recorder:profiles!ipd_intake_output_recorded_by_fkey(id, name)')
      .eq('admission_id', admissionId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as IntakeOutput[];
  },

  async recordIO(params: {
    clinicId: string;
    admissionId: string;
    ioType: 'intake' | 'output';
    route: string;
    volumeMl: number;
    notes?: string;
    /** ISO time the fluid was given/passed; omit for "now" */
    recordedAt?: string;
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
        notes: params.notes ?? null,
        recorded_by: params.userId ?? null,
        ...clinicalTime(params.recordedAt),
      })
      .select()
      .single();
    if (error) throw error;
    return data as IntakeOutput;
  },

  // --- amendments -----------------------------------------------------------
  //
  // Charted data is a clinical record, so correcting it is not an ordinary
  // update. Both calls go through SECURITY DEFINER functions that check the
  // 'ipd_vitals_amend' key and demand a reason, and every change lands in
  // ipd_chart_amendments with the before/after row. RLS blocks the direct
  // UPDATE/DELETE for anyone without the key, so there is no way round these.

  /**
   * Correct a charted entry. `patch` carries only the columns being changed —
   * including recorded_at (created_at on a note) when the time itself was
   * wrong. charted_at, tenancy and the original signature are not patchable.
   */
  async amendChartRow(params: {
    table: ChartTable;
    id: string;
    patch: Record<string, unknown>;
    reason: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('amend_ipd_chart_row', {
      p_table: params.table,
      p_id: params.id,
      p_patch: params.patch,
      p_reason: params.reason,
    });
    if (error) throw new Error(error.message);
  },

  /** Strike a charted entry. The row goes; the trail row stays. */
  async deleteChartRow(params: {
    table: ChartTable;
    id: string;
    reason: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('delete_ipd_chart_row', {
      p_table: params.table,
      p_id: params.id,
      p_reason: params.reason,
    });
    if (error) throw new Error(error.message);
  },

  /** The correction trail — every amendment and strike on this admission */
  async listAmendments(admissionId: string, limit = 200): Promise<ChartAmendment[]> {
    const { data, error } = await supabase
      .from('ipd_chart_amendments')
      .select('*, amender:profiles!ipd_chart_amendments_amended_by_fkey(id, name)')
      .eq('admission_id', admissionId)
      .order('amended_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as ChartAmendment[];
  },
};
