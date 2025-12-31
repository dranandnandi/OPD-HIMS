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
      .maybeSingle(); // Use maybeSingle to avoid error when no rule exists

    if (error || !data) return false;
    return data.enabled;
  }

  // Default templates as fallback
  static defaultTemplates: Record<string, string> = {
    'appointment_confirmed': 'Dear {{patientName}}, your appointment with Dr. {{doctorName}} is confirmed for {{appointmentDate}}. Please arrive 10 minutes early. - {{clinicName}}',
    'appointment_reminder': 'Reminder: You have an appointment tomorrow at {{appointmentDate}} with Dr. {{doctorName}}. Please confirm your attendance. - {{clinicName}}',
    'bill_created': 'Dear {{patientName}}, your bill #{{billNumber}} for {{totalAmount}} has been generated at {{clinicName}}. Balance: {{balanceAmount}}',
    'payment_received': 'Thank you {{patientName}}! Payment of {{amountPaid}} received for bill #{{billNumber}}. Balance: {{balanceAmount}} - {{clinicName}}',
    'visit_prescription': 'Dear {{patientName}}, your prescription is ready. Download here: {{pdfUrl}} - {{clinicName}}',
    'invoice_generated': 'Dear {{patientName}}, your invoice #{{billNumber}} for {{totalAmount}} is ready. Download: {{pdfUrl}} - {{clinicName}}',
    'gmb_review_request': 'Thank you for visiting {{clinicName}}! We hope you are feeling better. Please share your experience: {{reviewLink}}',
    'thank_you': 'Thank you for visiting {{clinicName}} today! We hope you feel better soon.'
  };

  // Get template for event type - uses clinic_settings.whatsapp_templates with fallback
  static async getTemplate(
    clinicId: string,
    eventType: WhatsAppEventType
  ): Promise<string | null> {
    // First try to get from clinic_settings.whatsapp_templates (new unified approach)
    const { data: clinicSettings, error: settingsError } = await supabase
      .from('clinic_settings')
      .select('whatsapp_templates')
      .eq('id', clinicId)
      .single();

    if (!settingsError && clinicSettings?.whatsapp_templates) {
      // Map event type to template key (handle naming differences)
      const templateKeyMap: Record<string, string> = {
        'appointment_confirmed': 'appointment_confirmation',
        'appointment_reminder': 'appointment_reminder',
        'bill_created': 'invoice_generated',
        'payment_received': 'payment_received',
        'visit_prescription': 'visit_prescription',
        'invoice_generated': 'invoice_generated',
        'gmb_review_request': 'thank_you',
        'thank_you': 'thank_you'
      };

      const templateKey = templateKeyMap[eventType] || eventType;
      const template = clinicSettings.whatsapp_templates[templateKey];

      if (template) {
        return template;
      }
    }

    // Fallback to old whatsapp_message_templates table for backwards compatibility
    const { data, error } = await supabase
      .from('whatsapp_message_templates')
      .select('message_content')
      .eq('clinic_id', clinicId)
      .eq('event_type', eventType)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      return data.message_content;
    }

    // Final fallback to default templates
    return this.defaultTemplates[eventType] || null;
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

  // Send Prescription PDF
  static async sendPrescriptionPdf(
    visitId: string,
    pdfUrl: string,
    _userId: string,
    clinicId: string
  ): Promise<void> {
    if (!supabase) return;
    const enabled = await this.isAutoSendEnabled(clinicId, 'visit_prescription');
    if (!enabled) return;

    // Fetch visit details to get patient info
    const { data: visit, error } = await supabase
      .from('visits')
      .select('*, patient:patients(*), doctor:profiles(*)')
      .eq('id', visitId)
      .single();

    if (error || !visit || !visit.patient?.phone) {
      console.warn('Cannot send prescription WhatsApp: Missing visit/patient/phone');
      return;
    }

    // Prepare message
    const template = await this.getTemplate(clinicId, 'visit_prescription');
    // Fallback message if no template found (though getTemplate handles default)
    const baseMessage = template || this.defaultTemplates['visit_prescription'];

    const message = replaceTemplateVariables(baseMessage, {
      patientName: visit.patient.name,
      clinicName: 'our clinic', // TODO: Fetch actual clinic name if available in context or pass it in
      pdfUrl: pdfUrl,
      pdfLink: pdfUrl, // Support both variable names
      doctorName: visit.doctor?.name || 'Doctor'
    });

    // We can use sendReportUrl for this which sends a message with a link
    // Or if we specifically want to send the file + caption, we can Queue it.
    // For consistency with this service's design, we'll QUEUE a message that contains the link.
    // However, the WhatsApp API 'sendReportUrl' might be better suited if we want the actual file attachment experience if supported.
    // For now, adhering to the 'text message with link' approach used in the templates:

    await this.queueMessage({
      clinicId,
      patientId: visit.patient.id,
      phoneNumber: visit.patient.phone,
      eventType: 'visit_prescription',
      messageContent: message,
      metadata: { visitId, pdfUrl }
    });
  }

  // Send Bill/Invoice PDF
  static async sendBillPdf(
    billId: string,
    pdfUrl: string,
    _userId: string,
    clinicId: string
  ): Promise<void> {
    if (!supabase) return;
    const enabled = await this.isAutoSendEnabled(clinicId, 'invoice_generated');
    if (!enabled) return;

    const { data: bill, error } = await supabase
      .from('bills')
      .select('*, patient:patients(*)')
      .eq('id', billId)
      .single();

    if (error || !bill || !bill.patient?.phone) {
      console.warn('Cannot send bill WhatsApp: Missing bill/patient/phone');
      return;
    }

    const template = await this.getTemplate(clinicId, 'invoice_generated');
    const baseMessage = template || this.defaultTemplates['invoice_generated'];

    const message = replaceTemplateVariables(baseMessage, {
      patientName: bill.patient.name,
      clinicName: 'our clinic',
      billNumber: bill.bill_number || bill.billNumber, // handle both casing if needed
      totalAmount: formatCurrency(bill.total_amount || bill.totalAmount),
      pdfUrl: pdfUrl,
      pdfLink: pdfUrl
    });

    await this.queueMessage({
      clinicId,
      patientId: bill.patient.id,
      phoneNumber: bill.patient.phone,
      eventType: 'invoice_generated',
      messageContent: message,
      metadata: { billId, pdfUrl }
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
