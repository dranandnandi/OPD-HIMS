import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Send WhatsApp document (base64)
 * POST /api/whatsapp-send-document
 * Body: { userId: string, to: string, fileBase64: string, fileName: string, mimeType: string, caption?: string }
 */

import { Handler } from '@netlify/functions';
import { forwardToWhatsApp, parseRequestBody, error, corsHeaders } from './_shared/whatsappClient';

export const handler: Handler = guardNetlify(async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return error('Method not allowed', 405);
  }

  try {
    const body = parseRequestBody(event.body);
    const { userId: authId, to, fileBase64, fileName, mimeType, caption } = body;

    if (!authId || !to || !fileBase64 || !fileName || !mimeType) {
      return error('Missing required fields: userId, to, fileBase64, fileName, mimeType', 400);
    }

    // Keep this aligned with whatsapp-send-message: the WhatsApp backend uses
    // the app userId directly for per-user sessions.
    const response = await forwardToWhatsApp(
      `/api/users/${authId}/whatsapp/send-document`,
      'POST',
      { phone: to, fileBase64, fileName, mimeType, caption }
    );

    return response;
  } catch (err) {
    console.error('[WhatsApp Send Document] Error:', err);
    return error('Failed to send document', 500);
  }
}, 'growth', 'whatsapp-send-document', false);
