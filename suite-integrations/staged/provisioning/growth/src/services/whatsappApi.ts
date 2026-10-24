import {productFetch} from '../suite/productFetch';
/**
 * WhatsApp API Client for GMB Review System
 * Integrates with DigitalOcean backend service via Netlify Functions
 * Based on: whatsapp.md documentation
 */

export interface WhatsAppStatus {
  connected?: boolean;
  isConnected?: boolean;
  phoneNumber?: string;
  sessionId?: string;
  businessName?: string;
  lastSyncAt?: string;
  queueSize?: number;
  success?: boolean;
  data?: {
    sessions?: Array<{
      sessionId: string;
      isConnected: boolean;
      phoneNumber: string;
      lastActivity: string;
    }>;
  };
}

export interface WhatsAppQRData {
  sessionId: string;
  qr?: string;  // Raw QR string
  qrCode: string;  // Can also be in qrCode field
  success: boolean;
  message?: string;
  data?: {
    qrCode?: string;
    sessionId?: string;
  };
}

export interface SendMessageRequest {
  phone: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface SendDocumentRequest {
  phone: string;
  fileName: string;
  fileBase64: string;
  caption?: string;
}

export interface SendFileUrlRequest {
  phone: string;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  patientName?: string;
  testName?: string;
}

export interface WhatsAppContext {
  userId: string;
  clinicId?: string;
}

class WhatsAppApiClient {
  private baseUrl = '/.netlify/functions';

  /**
   * Get current WhatsApp connection status
   */
  async getStatus(context: WhatsAppContext): Promise<WhatsAppStatus> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Status check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data as WhatsAppStatus;
    } catch (error) {
      console.error('Failed to get WhatsApp status:', error);
      throw error;
    }
  }

  /**
   * Generate QR code for WhatsApp connection
   */
  async getQr(context: WhatsAppContext): Promise<WhatsAppQRData> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`QR generation failed: ${detail || response.statusText}`);
      }

      const data = await response.json();
      return data as WhatsAppQRData;
    } catch (error) {
      console.error('Failed to generate QR code:', error);
      throw error;
    }
  }

  /**
   * Connect WhatsApp session (create session and get QR if available)
   */
  async connect(context: WhatsAppContext): Promise<any> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Connect failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data; // Return full response which may include QR code
    } catch (error) {
      console.error('Failed to connect WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Disconnect WhatsApp session
   */
  async disconnect(context: WhatsAppContext): Promise<void> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-disconnect`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Disconnect failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to disconnect WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Refresh QR code (get new QR without affecting session)
   */
  async refreshQr(context: WhatsAppContext): Promise<WhatsAppQRData> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-refresh-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Refresh QR failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data as WhatsAppQRData;
    } catch (error) {
      console.error('Failed to refresh QR code:', error);
      throw error;
    }
  }

  /**
   * Reconnect WhatsApp session (Code 428 recovery)
   */
  async reconnect(context: WhatsAppContext): Promise<any> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Reconnect failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to reconnect WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Send text message via WhatsApp
   */
  async sendMessage(
    request: SendMessageRequest,
    context: WhatsAppContext
  ): Promise<{ messageId: string }> {
    try {
      // Ensure phone number has country code (91 for India)
      let phoneWithCode = request.phone;
      if (!phoneWithCode.startsWith('91')) {
        phoneWithCode = '91' + phoneWithCode;
      }

      const response = await productFetch(`${this.baseUrl}/whatsapp-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phoneWithCode,  // Transform 'phone' to 'to' with country code for backend API
          message: request.message,
          metadata: request.metadata,
          ...context,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Send message failed: ${error}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to send WhatsApp message:', error);
      throw error;
    }
  }

  /**
   * Send document (base64) via WhatsApp
   */
  async sendDocument(
    request: SendDocumentRequest,
    context: WhatsAppContext
  ): Promise<{ messageId: string }> {
    try {
      // Ensure phone number has country code (91 for India)
      let phoneWithCode = request.phone;
      if (!phoneWithCode.startsWith('91')) {
        phoneWithCode = '91' + phoneWithCode;
      }

      const response = await productFetch(`${this.baseUrl}/whatsapp-send-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phoneWithCode,  // Transform 'phone' to 'to' with country code for backend API
          fileName: request.fileName,
          fileBase64: request.fileBase64,
          caption: request.caption,
          ...context,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Send document failed: ${error}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to send WhatsApp document:', error);
      throw error;
    }
  }

  /**
   * Send file via URL
   */
  async sendFileUrl(
    request: SendFileUrlRequest,
    context: WhatsAppContext
  ): Promise<{ messageId: string }> {
    try {
      // Ensure phone number has country code (91 for India)
      let phoneWithCode = request.phone;
      if (!phoneWithCode.startsWith('91')) {
        phoneWithCode = '91' + phoneWithCode;
      }

      const response = await productFetch(`${this.baseUrl}/whatsapp-send-report-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phoneWithCode,  // Transform 'phone' to 'to' with country code for backend API
          reportUrl: request.fileUrl,
          fileName: request.fileName || 'report.pdf',
          mimeType: request.mimeType || 'application/pdf',
          caption: request.caption,
          patientName: request.patientName,
          testName: request.testName,
          ...context,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Send file URL failed: ${error}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to send WhatsApp file URL:', error);
      throw error;
    }
  }

  /**
   * Sync user to WhatsApp backend database
   */
  async syncUser(userId: string, email: string, fullName: string): Promise<void> {
    try {
      const response = await productFetch(`${this.baseUrl}/whatsapp-sync-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email,
          fullName,
        }),
      });

      if (!response.ok) {
        throw new Error(`User sync failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to sync user:', error);
      throw error;
    }
  }
}

export const whatsappApi = new WhatsAppApiClient();
