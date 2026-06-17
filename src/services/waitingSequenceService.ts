import { supabase } from '../lib/supabase';
import { WhatsAppAutoSendService } from './whatsappAutoSendService';

export interface WaitingSequence {
  id: string;
  clinicId: string;
  conditionType: string;
  stepOrder: number;
  delayMinutes: number;
  message: string;
  isActive: boolean;
  createdAt: Date;
}

export interface WaitingSequenceGroup {
  conditionType: string;
  steps: WaitingSequence[];
}

const fromDb = (row: any): WaitingSequence => ({
  id: row.id,
  clinicId: row.clinic_id,
  conditionType: row.condition_type,
  stepOrder: row.step_order,
  delayMinutes: row.delay_minutes,
  message: row.message,
  isActive: row.is_active,
  createdAt: new Date(row.created_at),
});

export const waitingSequenceService = {
  async getAll(clinicId: string): Promise<WaitingSequence[]> {
    const { data, error } = await supabase!
      .from('waiting_sequences')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('condition_type')
      .order('step_order');
    if (error) throw error;
    return (data ?? []).map(fromDb);
  },

  async getConditionTypes(clinicId: string): Promise<string[]> {
    const { data, error } = await supabase!
      .from('waiting_sequences')
      .select('condition_type')
      .eq('clinic_id', clinicId)
      .eq('is_active', true);
    if (error) throw error;
    const types = [...new Set((data ?? []).map((r: any) => r.condition_type as string))];
    if (!types.includes('General')) types.unshift('General');
    return types;
  },

  async create(clinicId: string, step: Omit<WaitingSequence, 'id' | 'clinicId' | 'createdAt'>): Promise<WaitingSequence> {
    const { data, error } = await supabase!
      .from('waiting_sequences')
      .insert({
        clinic_id: clinicId,
        condition_type: step.conditionType,
        step_order: step.stepOrder,
        delay_minutes: step.delayMinutes,
        message: step.message,
        is_active: step.isActive,
      })
      .select()
      .single();
    if (error) throw error;
    return fromDb(data);
  },

  async update(id: string, updates: Partial<Pick<WaitingSequence, 'conditionType' | 'stepOrder' | 'delayMinutes' | 'message' | 'isActive'>>): Promise<void> {
    const dbUpdates: any = {};
    if (updates.conditionType !== undefined) dbUpdates.condition_type = updates.conditionType;
    if (updates.stepOrder !== undefined) dbUpdates.step_order = updates.stepOrder;
    if (updates.delayMinutes !== undefined) dbUpdates.delay_minutes = updates.delayMinutes;
    if (updates.message !== undefined) dbUpdates.message = updates.message;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    dbUpdates.updated_at = new Date().toISOString();
    const { error } = await supabase!.from('waiting_sequences').update(dbUpdates).eq('id', id);
    if (error) throw error;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase!.from('waiting_sequences').delete().eq('id', id);
    if (error) throw error;
  },

  // Called when appointment status → Arrived
  async startSequence(params: {
    clinicId: string;
    appointmentId: string;
    patientId: string;
    patientPhone: string;
    conditionType: string;
    arrivalTime: Date;
    appointmentTime: Date;
  }): Promise<void> {
    console.log('[WaitingSeq] startSequence called', params);

    await supabase!
      .from('appointments')
      .update({ waiting_condition_type: params.conditionType })
      .eq('id', params.appointmentId);

    let { data: steps, error: stepsErr } = await supabase!
      .from('waiting_sequences')
      .select('*')
      .eq('clinic_id', params.clinicId)
      .eq('condition_type', params.conditionType)
      .eq('is_active', true)
      .order('step_order');

    console.log('[WaitingSeq] steps for condition', params.conditionType, steps, stepsErr);

    if (!steps || steps.length === 0) {
      const { data: general } = await supabase!
        .from('waiting_sequences')
        .select('*')
        .eq('clinic_id', params.clinicId)
        .eq('condition_type', 'General')
        .eq('is_active', true)
        .order('step_order');
      steps = general ?? [];
      console.log('[WaitingSeq] fallback General steps', steps);
    }

    if (!steps || steps.length === 0) {
      console.warn('[WaitingSeq] No steps found — nothing queued.');
      return;
    }

    for (const step of steps) {
      const scheduledAt = new Date(params.arrivalTime.getTime() + step.delay_minutes * 60 * 1000);
      console.log(`[WaitingSeq] step ${step.step_order}: scheduledAt=${scheduledAt.toISOString()} apptTime=${params.appointmentTime.toISOString()} skip=${scheduledAt >= params.appointmentTime}`);
      if (scheduledAt >= params.appointmentTime) continue;

      await WhatsAppAutoSendService.queueMessage({
        clinicId: params.clinicId,
        patientId: params.patientId,
        phoneNumber: params.patientPhone,
        eventType: 'appointment_reminder',
        messageContent: step.message,
        metadata: {
          appointmentId: params.appointmentId,
          waitingSequenceId: step.id,
          conditionType: params.conditionType,
          isWaitingSequence: true,
        },
        scheduledAt,
      });
      console.log(`[WaitingSeq] step ${step.step_order} queued OK`);
    }
  },

  // Called when appointment status → In_Progress / Completed / Cancelled
  async cancelSequence(appointmentId: string): Promise<void> {
    await supabase!
      .from('whatsapp_message_queue')
      .update({ status: 'cancelled' })
      .eq('status', 'pending')
      .contains('metadata', { appointmentId, isWaitingSequence: true });
  },
};
