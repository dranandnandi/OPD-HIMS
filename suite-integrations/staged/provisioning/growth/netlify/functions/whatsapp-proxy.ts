import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Generic WhatsApp API proxy
 * POST /api/whatsapp-proxy
 * Body: { userId: string, endpoint: string, method: 'GET' | 'POST', data?: any }
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
    const { userId: authId, endpoint, method, data } = body;

    if (!authId || !endpoint || !method) {
      return error('Missing required fields: userId, endpoint, method', 400);
    }

    if (!['GET', 'POST'].includes(method)) {
      return error('Invalid method. Must be GET or POST', 400);
    }

    // Look up backend user ID
    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend', 404);
    }

    // Replace {userId} placeholder in endpoint
    const finalEndpoint = endpoint.replace('{userId}', backendUserId);

    // Forward to backend
    const response = await forwardToWhatsApp(finalEndpoint, method, data);

    return response;
  } catch (err) {
    console.error('[WhatsApp Proxy] Error:', err);
    return error('Proxy request failed', 500);
  }
}, 'growth', 'whatsapp-proxy', false);
