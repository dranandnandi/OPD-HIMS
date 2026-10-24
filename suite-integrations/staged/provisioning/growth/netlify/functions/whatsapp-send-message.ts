import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Send WhatsApp text message
 * POST /api/whatsapp-send-message
 * Body: { userId: string, to: string, message: string, labContext?: { labId: string, labName: string } }
 */

import { Handler } from '@netlify/functions';
import { forwardToWhatsApp, parseRequestBody, ensureLabContext, error, corsHeaders } from './_shared/whatsappClient';
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
    let { userId, to, message, labContext } = body;

    if (!userId || !to || !message) {
      return error('Missing required fields: userId, to, message', 400);
    }

    // Validate lab context if provided
    if (labContext && !ensureLabContext(labContext)) {
      return error('Invalid labContext', 400);
    }

    // Ensure phone number has country code (91 for India)
    if (!to.startsWith('91')) {
      to = '91' + to;
    }

    // Use userId directly
    console.log('[WhatsApp Send Message] Forwarding to backend with userId:', userId, 'phoneNumber:', to);

    // Forward to backend - backend expects 'phoneNumber' and 'message' fields
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/send-message`,
      'POST',
      { phoneNumber: to, message }
    );

    return response;
  } catch (err) {
    console.error('[WhatsApp Send Message] Error:', err);
    return error('Failed to send message', 500);
  }
}, 'growth', 'whatsapp-send-message', false);
