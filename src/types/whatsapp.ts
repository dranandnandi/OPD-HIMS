// WhatsApp Auto-Send Management Types

export type WhatsAppEventType =
  | 'appointment_confirmed'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'bill_created'
  | 'payment_received'
  | 'gmb_review_request'
  | 'prescription_ready'
  | 'test_result_ready'
  | 'follow_up_reminder'
  | 'visit_prescription'
  | 'invoice_generated';

export interface WhatsAppAutoSendRule {
  id: string;
  clinicId: string;
  eventType: WhatsAppEventType;
  enabled: boolean;
  templateId: string;
  delayMinutes: number; // 0 = immediate, >0 = delayed
  conditions?: {
    minBillAmount?: number;
    appointmentTypes?: string[];
    paymentMethods?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppMessageTemplate {
  id: string;
  clinicId: string;
  name: string;
  eventType: WhatsAppEventType;
  messageContent: string;
  variables: string[]; // e.g., ['patientName', 'appointmentDate', 'clinicName']
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppMessageQueue {
  id: string;
  clinicId: string;
  patientId: string;
  phoneNumber: string;
  eventType: WhatsAppEventType;
  messageContent: string;
  metadata: Record<string, any>;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  scheduledAt: Date;
  sentAt?: Date;
  error?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppMessageLog {
  id: string;
  clinicId: string;
  patientId: string;
  phoneNumber: string;
  eventType: WhatsAppEventType;
  messageContent: string;
  status: 'sent' | 'failed';
  sentAt: Date;
  messageId?: string;
  error?: string;
  metadata: Record<string, any>;
}
