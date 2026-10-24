import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Disconnect WhatsApp session
 * DELETE /api/whatsapp-disconnect
 * Body: { userId: string }
 */

import { Handler } from '@netlify/functions';
import { forwardToWhatsApp, parseRequestBody, error, corsHeaders } from './_shared/whatsappClient';
import { getUserIdFromAuthId } from './_shared/userLookup';

export const handler: Handler = guardNetlify(async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'DELETE') {
    return error('Method not allowed', 405);
  }

  try {
    const body = parseRequestBody(event.body);
    const userId = body.userId;

    if (!userId) {
      return error('Missing userId in request body', 400);
    }

    // Use userId directly
    console.log('[WhatsApp Disconnect] Forwarding to backend with userId:', userId);

    // Forward to backend using DELETE method to /api/users/{userId}/whatsapp/session
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/session`,
      'DELETE'
    );

    return response;
  } catch (err) {
    console.error('[WhatsApp Disconnect] Error:', err);
    return error('Failed to disconnect', 500);
  }
}, 'growth', 'whatsapp-disconnect', false);
