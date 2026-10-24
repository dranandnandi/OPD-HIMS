import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Reconnect WhatsApp session (Code 428 recovery)
 * POST /api/whatsapp-reconnect
 * Body: { userId: string }
 * 
 * This endpoint is used to recover from Code 428 errors (session expires)
 * by re-authenticating with the same session.
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
    const userId = body.userId;

    if (!userId) {
      return error('Missing userId in request body', 400);
    }

    console.log('[WhatsApp Reconnect] Attempting to reconnect userId:', userId);

    // Forward to backend reconnect endpoint
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/reconnect`,
      'POST',
      body
    );

    console.log('[WhatsApp Reconnect] Backend response status:', response.statusCode);

    return response;
  } catch (err) {
    console.error('[WhatsApp Reconnect] Error:', err);
    return error('Failed to reconnect WhatsApp', 500);
  }
}, 'growth', 'whatsapp-reconnect', false);
