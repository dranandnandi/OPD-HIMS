import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Initiate WhatsApp connection
 * POST /api/whatsapp-connect
 * Body: { userId: string }
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

    console.log(`[WhatsApp Connect] Creating session for userId: ${userId}`);

    // Forward to backend to create session - send full payload like OPD app
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/connect`,
      'POST',
      body  // Pass entire context (userId and any additional fields)
    );

    // Log the actual response to see what backend returns
    console.log('[WhatsApp Connect] Backend response status:', response.statusCode);
    console.log('[WhatsApp Connect] Backend response body:', response.body);

    return response;
  } catch (err) {
    console.error('[WhatsApp Connect] Error:', err);
    return error('Failed to initiate connection', 500);
  }
}, 'growth', 'whatsapp-connect', false);
