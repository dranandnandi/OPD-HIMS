import type { Bill, Patient } from '../types';

export type WhatsAppApiMode = 'netlify-functions' | 'direct';

export interface WhatsAppApiConfig {
  mode?: WhatsAppApiMode;
  functionBase?: string;
  directBase?: string;
}

export interface WhatsAppContextInput {
  clinicId?: string;
  labId?: string;
  userId?: string;
  email?: string;
  channel?: string;
}

export interface WhatsAppStatusResponse {
  connected: boolean;
  phoneNumber?: string;
  businessName?: string;
  lastSyncAt?: string;
  startedAt?: string;
  sessionId?: string;
  queueSize?: number;
  [key: string]: unknown;
}

export interface WhatsAppQrResponse {
  qrImage?: string;
  qr?: string;
  expiresAt?: string;
  instructions?: string;
  [key: string]: unknown;
}

export interface WhatsAppSendMessageInput {
  phone: string;
  message: string;
  template?: string;
  variables?: Record<string, string | number>;
  metadata?: Record<string, unknown>;
}

export interface WhatsAppSendDocumentInput {
  phone: string;
  caption?: string;
  fileBase64: string;
  fileName: string;
}

export interface WhatsAppSendFileUrlInput {
  phone: string;
  fileUrl: string;
  caption?: string;
}

export interface WhatsAppSendReportInput {
  phone: string;
  reportHtml?: string;
  reportPdfBase64?: string;
  patient?: Patient;
  visitId?: string;
}

const JSON_CONTENT_TYPES = ['application/json', 'text/json'];
const DEFAULT_MODE: WhatsAppApiMode = (import.meta.env.VITE_WHATSAPP_API_MODE as WhatsAppApiMode) || 'netlify-functions';
const DEFAULT_FUNCTION_BASE = import.meta.env.VITE_WHATSAPP_FUNCTION_BASE || '/.netlify/functions';
const DEFAULT_DIRECT_BASE = import.meta.env.VITE_WHATSAPP_API_BASE_URL || '';

const FUNCTION_MAP = {
  connect: 'whatsapp-connect',
  disconnect: 'whatsapp-disconnect',
  status: 'whatsapp-status',
  qr: 'whatsapp-qr',
  sendMessage: 'whatsapp-send-message',
  sendDocument: 'whatsapp-send-document',
  sendFileUrl: 'whatsapp-send-file-url',
  sendReport: 'whatsapp-send-report',
  sendReportUrl: 'whatsapp-send-report-url',
  sendBillPdf: 'whatsapp-send-bill',
  syncUser: 'whatsapp-sync-user',
  proxy: 'whatsapp-proxy'
} as const;

type JsonRecord = Record<string, unknown>;

type FunctionName = (typeof FUNCTION_MAP)[keyof typeof FUNCTION_MAP];

const normalizeBase = (value?: string) => {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const joinUrl = (base: string, path: string) => `${base}${path.startsWith('/') ? '' : '/'}${path}`;

const parseJsonSafely = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const isJsonResponse = (contentType: string) =>
  JSON_CONTENT_TYPES.some((token) => contentType.toLowerCase().includes(token));

const hasMessageField = (value: unknown): value is { message?: string } =>
  typeof value === 'object' && value !== null && 'message' in value;

export class WhatsAppAPI {
  private readonly config: Required<WhatsAppApiConfig>;

  constructor(config: WhatsAppApiConfig = {}) {
    const normalizedFunctionBase = normalizeBase(config.functionBase || DEFAULT_FUNCTION_BASE) || '/.netlify/functions';
    this.config = {
      mode: config.mode || DEFAULT_MODE,
      functionBase: normalizedFunctionBase,
      directBase: normalizeBase(config.directBase || DEFAULT_DIRECT_BASE)
    };
  }

  async connect(body: JsonRecord = {}, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.connect, body, context);
  }

  async disconnect(body: JsonRecord = {}, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.disconnect, body, context);
  }

  async getStatus(body: JsonRecord = {}, context?: WhatsAppContextInput) {
    return this.post<WhatsAppStatusResponse>(FUNCTION_MAP.status, body, context);
  }

  async getQr(body: JsonRecord = {}, context?: WhatsAppContextInput) {
    return this.post<WhatsAppQrResponse>(FUNCTION_MAP.qr, body, context);
  }

  async sendMessage(payload: WhatsAppSendMessageInput, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.sendMessage, payload as unknown as JsonRecord, context);
  }

  async sendDocument(payload: WhatsAppSendDocumentInput, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.sendDocument, payload as unknown as JsonRecord, context);
  }

  async sendFileUrl(payload: WhatsAppSendFileUrlInput, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.sendFileUrl, payload as unknown as JsonRecord, context);
  }

  async sendReport(payload: WhatsAppSendReportInput, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.sendReport, payload as unknown as JsonRecord, context);
  }

  async sendReportUrl(payload: { phone: string; reportUrl: string; caption?: string }, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.sendReportUrl, payload as unknown as JsonRecord, context);
  }

  async sendBillPdf(payload: { 
    phone: string; 
    fileUrl: string; 
    caption?: string;
    fileName?: string;
    billNumber?: string;
    patientName?: string;
    totalAmount?: number;
  }, context?: WhatsAppContextInput) {
    // Transform phone to phoneNumber for the backend and ensure country code
    const { phone, ...rest } = payload;
    
    // Ensure phone number has country code
    let phoneNumber = phone;
    
    // Remove any + prefix
    if (phoneNumber.startsWith('+')) {
      phoneNumber = phoneNumber.substring(1);
    }
    
    // Remove leading 0 if present (e.g., 08780465286 -> 8780465286)
    if (phoneNumber.startsWith('0')) {
      phoneNumber = phoneNumber.substring(1);
    }
    
    // Add 91 if not already present (Indian country code)
    if (!phoneNumber.startsWith('91')) {
      phoneNumber = '91' + phoneNumber;
    }
    
    const transformedPayload = {
      phoneNumber: phoneNumber,
      ...rest
    };
    return this.post(FUNCTION_MAP.sendBillPdf, transformedPayload as unknown as JsonRecord, context);
  }

  async syncUser(payload: { user: JsonRecord }, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.syncUser, payload as unknown as JsonRecord, context);
  }

  async proxy(payload: { path: string; method?: string; headers?: Record<string, string>; payload?: JsonRecord }, context?: WhatsAppContextInput) {
    return this.post(FUNCTION_MAP.proxy, payload as unknown as JsonRecord, context);
  }

  private resolveEndpoint(functionName: FunctionName) {
    if (this.config.mode === 'netlify-functions' || !this.config.directBase) {
      return joinUrl(this.config.functionBase, functionName);
    }
    return joinUrl(this.config.directBase, functionName);
  }

  private withContext(body: JsonRecord = {}, context?: WhatsAppContextInput) {
    const merged: JsonRecord = {
      channel: context?.channel || body.channel || 'OPD',
      ...body
    };

    const labId = body.labId || context?.labId || context?.clinicId;
    if (labId) merged.labId = labId;
    if (context?.clinicId) merged.clinicId = context.clinicId;
    if (context?.userId && !merged.userId) merged.userId = context.userId;
    if (context?.email && !merged.email) merged.email = context.email;

    return merged;
  }

  private async post<T = JsonRecord>(functionName: FunctionName, body: JsonRecord = {}, context?: WhatsAppContextInput) {
    const endpoint = this.resolveEndpoint(functionName);
    const payload = this.withContext(body, context);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    const contentType = response.headers?.get?.('content-type') || '';
    const data = raw && isJsonResponse(contentType) ? parseJsonSafely(raw) : raw;

    if (!response.ok) {
      const message = hasMessageField(data) && typeof data.message === 'string'
        ? data.message
        : 'WhatsApp request failed';
      throw new Error(message);
    }

    return (data as T) ?? ({} as T);
  }
}

export const whatsappApi = new WhatsAppAPI();

export const buildInvoiceMessage = (bill: Bill, clinicName?: string) => {
  const patientName = bill.patient?.name || 'Patient';
  const total = bill.totalAmount.toLocaleString('en-IN');
  const paid = bill.paidAmount.toLocaleString('en-IN');
  const balance = bill.balanceAmount.toLocaleString('en-IN');
  const lines = [
    `Dear ${patientName},`,
    `Thank you for visiting ${clinicName || 'our clinic'}.`,
    `Bill #${bill.billNumber}`,
    `Total: ₹${total}`,
    `Paid: ₹${paid}`,
    `Balance: ₹${balance}`
  ];
  if (bill.balanceAmount > 0) {
    lines.push('Kindly clear the balance at your convenience.');
  }
  lines.push('Regards,', clinicName || 'Clinic Team');
  return lines.join('\n');
};