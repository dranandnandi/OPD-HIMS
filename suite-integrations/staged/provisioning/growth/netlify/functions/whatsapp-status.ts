import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Check WhatsApp connection status
 * POST /api/whatsapp-status
 * Body: { userId: string }
 */

import { Handler } from '@netlify/functions';
import { forwardToWhatsApp, parseRequestBody, error, corsHeaders } from './_shared/whatsappClient';
import { getUserIdFromAuthId } from './_shared/userLookup';

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
    
    console.log('[WhatsApp Status] Received request for userId:', userId);
    
    if (!userId) {
      return error('Missing userId in request body', 400);
    }

    // Use userId directly - it's the Neon user ID that the backend already knows
    console.log('[WhatsApp Status] Forwarding to backend with userId:', userId);
    
    // Forward to backend
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/status`,
      'GET'
    );

    // Log the actual response to see what backend returns
    console.log('[WhatsApp Status] Backend response status:', response.statusCode);
    console.log('[WhatsApp Status] Backend response body:', response.body);

    return response;
  } catch (err) {
    console.error('[WhatsApp Status] Error:', err);
    return error('Failed to check WhatsApp status', 500);
  }
}, 'growth', 'whatsapp-status', false);
