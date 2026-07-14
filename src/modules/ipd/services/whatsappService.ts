// IPD WhatsApp messaging — rides on the OPD app's WhatsApp infrastructure:
// same session (whatsappApi + shared-session resolution) and the same
// whatsapp_message_log table, with ipd_* event types.
import { supabase } from '../utils/supabase';
import { whatsappApi } from '../../../services/whatsappApi';
import { formatPhoneForWhatsApp } from '../../../utils/phoneUtils';
import { resolveWhatsAppUserId } from '../../../services/clinicSettingsService';
import type { Admission } from '../types/ipd';

export type IpdWhatsAppEvent = 'ipd_admission' | 'ipd_discharge' | 'ipd_bill_summary';

interface SendParams {
  clinicId: string;
  /** current user's id — resolved to the clinic's shared WhatsApp session when enabled */
  userId: string;
  patientId?: string | null;
  phone: string;
  eventType: IpdWhatsAppEvent;
  message: string;
  metadata?: Record<string, unknown>;
}

const clinicNameCache = new Map<string, string>();

async function getClinicName(clinicId: string): Promise<string> {
  const cached = clinicNameCache.get(clinicId);
  if (cached) return cached;
  const { data } = await supabase
    .from('clinic_settings')
    .select('clinic_name')
    .eq('id', clinicId)
    .maybeSingle();
  const name = data?.clinic_name ?? 'our clinic';
  clinicNameCache.set(clinicId, name);
  return name;
}

function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

const inr = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export const ipdWhatsappService = {
  /** Low-level send + log. Throws when the send fails (after logging the failure). */
  async send(params: SendParams): Promise<void> {
    const phone = formatPhoneForWhatsApp(params.phone);
    if (!phone) throw new Error('Patient has no valid phone number');

    const resolvedUserId = await resolveWhatsAppUserId(params.userId, params.clinicId);
    const logBase = {
      clinic_id: params.clinicId,
      patient_id: params.patientId ?? null,
      phone_number: params.phone,
      event_type: params.eventType,
      message_content: params.message,
      sent_at: new Date().toISOString(),
      metadata: params.metadata ?? {},
    };

    try {
      await whatsappApi.sendMessage(
        {
          phone,
          message: params.message,
          metadata: { ...params.metadata, eventType: params.eventType, module: 'ipd' },
        },
        { userId: resolvedUserId, clinicId: params.clinicId }
      );
      await supabase.from('whatsapp_message_log').insert({ ...logBase, status: 'sent' });
    } catch (error) {
      await supabase.from('whatsapp_message_log').insert({
        ...logBase,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  },

  /** Admission confirmation to the patient (or attendant) right after admit. */
  async sendAdmissionWelcome(params: {
    clinicId: string;
    userId: string;
    admissionId: string;
    admissionNumber: string;
    patientId: string;
    patientName: string;
    phone: string;
    bedLabel?: string;
    doctorName?: string;
  }): Promise<void> {
    const clinicName = await getClinicName(params.clinicId);
    const lines = [
      `Dear ${params.patientName},`,
      '',
      `Your admission at ${clinicName} is confirmed.`,
      `Admission No: ${params.admissionNumber}`,
      `Date: ${formatDateTime(new Date())}`,
      ...(params.bedLabel ? [`Ward/Bed: ${params.bedLabel}`] : []),
      ...(params.doctorName ? [`Doctor: ${params.doctorName}`] : []),
      '',
      `Our team is here for you round the clock. Wishing you a speedy recovery!`,
      `— ${clinicName}`,
    ];
    await this.send({
      clinicId: params.clinicId,
      userId: params.userId,
      patientId: params.patientId,
      phone: params.phone,
      eventType: 'ipd_admission',
      message: lines.join('\n'),
      metadata: { admission_id: params.admissionId, admission_number: params.admissionNumber },
    });
  },

  /** Discharge message sent when the patient is discharged. */
  async sendDischargeMessage(params: {
    clinicId: string;
    userId: string;
    admission: Admission;
  }): Promise<void> {
    const { admission } = params;
    const phone = admission.patient?.phone || admission.attendant_phone || '';
    const clinicName = await getClinicName(params.clinicId);
    const lines = [
      `Dear ${admission.patient?.name ?? 'Patient'},`,
      '',
      `You have been discharged from ${clinicName} on ${formatDateTime(new Date())}.`,
      `Admission No: ${admission.admission_number}`,
      '',
      'Please follow the advice in your discharge summary, take medicines as prescribed, and book your follow-up on time.',
      '',
      `Get well soon!`,
      `— ${clinicName}`,
    ];
    await this.send({
      clinicId: params.clinicId,
      userId: params.userId,
      patientId: admission.patient_id,
      phone,
      eventType: 'ipd_discharge',
      message: lines.join('\n'),
      metadata: { admission_id: admission.id, admission_number: admission.admission_number },
    });
  },

  /** Running-bill summary (unbilled / deposits / outstanding) to the patient. */
  async sendBillSummary(params: {
    clinicId: string;
    userId: string;
    admissionId: string;
    admissionNumber: string;
    patientId?: string | null;
    patientName: string;
    phone: string;
    unbilledCharges: number;
    depositsHeld: number;
    billBalance: number;
  }): Promise<void> {
    const clinicName = await getClinicName(params.clinicId);
    const lines = [
      `Dear ${params.patientName},`,
      '',
      `Billing update for your admission (${params.admissionNumber}) at ${clinicName}:`,
      `• Charges not yet billed: ${inr(params.unbilledCharges)}`,
      `• Deposits held: ${inr(params.depositsHeld)}`,
      `• Outstanding on bills: ${inr(params.billBalance)}`,
      '',
      'For any clarification please contact our billing desk.',
      `— ${clinicName}`,
    ];
    await this.send({
      clinicId: params.clinicId,
      userId: params.userId,
      patientId: params.patientId,
      phone: params.phone,
      eventType: 'ipd_bill_summary',
      message: lines.join('\n'),
      metadata: { admission_id: params.admissionId, admission_number: params.admissionNumber },
    });
  },
};
