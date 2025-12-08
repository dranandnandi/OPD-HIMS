import { supabase } from '../lib/supabase';
import { whatsappApi } from './whatsappApi';
import { formatPhoneForWhatsApp } from '../utils/phoneUtils';
import type { WhatsAppEventType, WhatsAppMessageQueue } from '../types/whatsapp';
import type { Appointment, Bill, Patient, Review } from '../types';

// Template variables replacement
function replaceTemplateVariables(
  template: string, 
  variables: Record<string, string>
): string {
  let message = template;
  Object.entries(variables).forEach(([key, value]) => {
    message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });
  return message;
}

// Format date for messages
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
}

// Format currency
function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

export class WhatsAppAutoSendService {
  // Check if auto-send is enabled for an event type
  static async isAutoSendEnabled(
    clinicId: string, 
    eventType: WhatsAppEventType
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('whatsapp_auto_send_rules')
      .select('enabled')
      .eq('clinic_id', clinicId)
      .eq('event_type', eventType)
      .single();

    if (error || !data) return false;
    return data.enabled;
  }

  // Get template for event type
  static async getTemplate(
    clinicId: string, 
    eventType: WhatsAppEventType
  ): Promise<string | null> {
    const { data, error } = await supabase
      .from('whatsapp_message_templates')
      .select('message_content')
      .eq('clinic_id', clinicId)
      .eq('event_type', eventType)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.message_content;
  }

  // Queue a message for sending
  static async queueMessage(params: {
    clinicId: string;
    patientId: string;
    phoneNumber: string;
    eventType: WhatsAppEventType;
    messageContent: string;
    metadata?: Record<string, any>;
    delayMinutes?: number;
  }): Promise<void> {
    const scheduledAt = new Date();
    if (params.delayMinutes) {
      scheduledAt.setMinutes(scheduledAt.getMinutes() + params.delayMinutes);
    }

    await supabase.from('whatsapp_message_queue').insert({
      clinic_id: params.clinicId,
      patient_id: params.patientId,
      phone_number: params.phoneNumber,
      event_type: params.eventType,
      message_content: params.messageContent,
      metadata: params.metadata || {},
      status: 'pending',
      scheduled_at: scheduledAt.toISOString(),
      retry_count: 0
    });
  }

  // Send queued message immediately
  static async sendQueuedMessage(
    queueId: string,
    userId: string,
    clinicId: string
  ): Promise<void> {
    const { data: queueItem, error: fetchError } = await supabase
      .from('whatsapp_message_queue')
      .select('*')
      .eq('id', queueId)
      .single();

    if (fetchError || !queueItem) {
      throw new Error('Queue item not found');
    }

    try {
      // Send via WhatsApp API
      await whatsappApi.sendMessage(
        {
          phone: formatPhoneForWhatsApp(queueItem.phone_number),
          message: queueItem.message_content,
          metadata: {
            ...queueItem.metadata,
            eventType: queueItem.event_type
          }
        },
        { userId, clinicId }
      );

      // Update queue status
      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', queueId);

      // Log the message
      await supabase.from('whatsapp_message_log').insert({
        clinic_id: queueItem.clinic_id,
        patient_id: queueItem.patient_id,
        phone_number: queueItem.phone_number,
        event_type: queueItem.event_type,
        message_content: queueItem.message_content,
        status: 'sent',
        sent_at: new Date().toISOString(),
        metadata: queueItem.metadata
      });
    } catch (error) {
      // Update queue with error
      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          retry_count: queueItem.retry_count + 1
        })
        .eq('id', queueId);

      // Log failure
      await supabase.from('whatsapp_message_log').insert({
        clinic_id: queueItem.clinic_id,
        patient_id: queueItem.patient_id,
        phone_number: queueItem.phone_number,
        event_type: queueItem.event_type,
        message_content: queueItem.message_content,
        status: 'failed',
        sent_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: queueItem.metadata
      });

      throw error;
    }
  }

  // Appointment Confirmed
  static async sendAppointmentConfirmation(
    appointment: Appointment,
    patient: Patient,
    clinicName: string,
    userId: string,
    clinicId: string
  ): Promise<void> {
    const enabled = await this.isAutoSendEnabled(clinicId, 'appointment_confirmed');
    if (!enabled || !patient.phone) return;

    const template = await this.getTemplate(clinicId, 'appointment_confirmed');
    if (!template) return;

    const message = replaceTemplateVariables(template, {
      patientName: patient.name,
      clinicName,
      appointmentDate: formatDate(appointment.appointmentDate),
      appointmentType: appointment.appointmentType,
      doctorName: appointment.doctor?.full_name || 'Doctor'
    });

    await this.queueMessage({
      clinicId,
      patientId: patient.id,
      phoneNumber: patient.phone,
      eventType: 'appointment_confirmed',
      messageContent: message,
      metadata: { appointmentId: appointment.id }
    });
  }

  // Bill Created
  static async sendBillNotification(
    bill: Bill,
    patient: Patient,
    clinicName: string,
    userId: string,
    clinicId: string
  ): Promise<void> {
    const enabled = await this.isAutoSendEnabled(clinicId, 'bill_created');
    if (!enabled || !patient.phone) return;

    const template = await this.getTemplate(clinicId, 'bill_created');
    if (!template) return;

    const message = replaceTemplateVariables(template, {
      patientName: patient.name,
      clinicName,
      billNumber: bill.billNumber,
      totalAmount: formatCurrency(bill.totalAmount),
      paidAmount: formatCurrency(bill.paidAmount),
      balanceAmount: formatCurrency(bill.balanceAmount),
      paymentStatus: bill.paymentStatus
    });

    await this.queueMessage({
      clinicId,
      patientId: patient.id,
      phoneNumber: patient.phone,
      eventType: 'bill_created',
      messageContent: message,
      metadata: { billId: bill.id }
    });
  }

  // Payment Received
  static async sendPaymentConfirmation(
    bill: Bill,
    patient: Patient,
    amountPaid: number,
    clinicName: string,
    userId: string,
    clinicId: string
  ): Promise<void> {
    const enabled = await this.isAutoSendEnabled(clinicId, 'payment_received');
    if (!enabled || !patient.phone) return;

    const template = await this.getTemplate(clinicId, 'payment_received');
    if (!template) return;

    const message = replaceTemplateVariables(template, {
      patientName: patient.name,
      clinicName,
      billNumber: bill.billNumber,
      amountPaid: formatCurrency(amountPaid),
      balanceAmount: formatCurrency(bill.balanceAmount),
      totalAmount: formatCurrency(bill.totalAmount)
    });

    await this.queueMessage({
      clinicId,
      patientId: patient.id,
      phoneNumber: patient.phone,
      eventType: 'payment_received',
      messageContent: message,
      metadata: { billId: bill.id, amountPaid }
    });
  }

  // GMB Review Request
  static async sendGMBReviewRequest(
    patient: Patient,
    gmbLink: string,
    clinicName: string,
    userId: string,
    clinicId: string
  ): Promise<void> {
    const enabled = await this.isAutoSendEnabled(clinicId, 'gmb_review_request');
    if (!enabled || !patient.phone) return;

    const template = await this.getTemplate(clinicId, 'gmb_review_request');
    if (!template) return;

    const message = replaceTemplateVariables(template, {
      patientName: patient.name,
      clinicName,
      reviewLink: gmbLink
    });

    await this.queueMessage({
      clinicId,
      patientId: patient.id,
      phoneNumber: patient.phone,
      eventType: 'gmb_review_request',
      messageContent: message,
      metadata: { gmbLink },
      delayMinutes: 60 // Send after 1 hour
    });
  }

  // Process pending messages (called by background job)
  static async processPendingMessages(userId: string, clinicId: string): Promise<number> {
    const now = new Date().toISOString();
    
    const { data: pendingMessages, error } = await supabase
      .from('whatsapp_message_queue')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .lt('retry_count', 3) // Max 3 retries
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (error || !pendingMessages) return 0;

    let sentCount = 0;
    for (const message of pendingMessages) {
      try {
        await this.sendQueuedMessage(message.id, userId, clinicId);
        sentCount++;
      } catch (error) {
        console.error(`Failed to send message ${message.id}:`, error);
      }
    }

    return sentCount;
  }
}
