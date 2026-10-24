import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Send WhatsApp file via URL
 * POST /api/whatsapp-send-file-url
 * Body: { userId: string, to: string, fileUrl: string, fileName: string, mimeType: string, caption?: string }
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
    const { userId: authId, to, fileUrl, fileName, mimeType, caption } = body;

    if (!authId || !to || !fileUrl || !fileName || !mimeType) {
      return error('Missing required fields: userId, to, fileUrl, fileName, mimeType', 400);
    }

    // Keep this aligned with whatsapp-send-message: the WhatsApp backend uses
    // the app userId directly for per-user sessions.
    const response = await forwardToWhatsApp(
      `/api/users/${authId}/whatsapp/send-file-url`,
      'POST',
      { phone: to, fileUrl, fileName, mimeType, caption }
    );

    return response;
  } catch (err) {
    console.error('[WhatsApp Send File URL] Error:', err);
    return error('Failed to send file', 500);
  }
}, 'growth', 'whatsapp-send-file-url', false);
