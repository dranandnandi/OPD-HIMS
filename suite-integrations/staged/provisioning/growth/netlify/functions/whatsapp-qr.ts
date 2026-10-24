import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Get WhatsApp QR code
 * POST /api/whatsapp-qr with { userId: "xxx" }
 */

import { Handler } from '@netlify/functions';
import { forwardToWhatsApp, parseRequestBody, error, corsHeaders, ok } from './_shared/whatsappClient';

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
    
    console.log('[WhatsApp QR] Received request for userId:', userId);
    
    if (!userId) {
      return error('Missing userId in request body', 400);
    }

    console.log('[WhatsApp QR] Calling connect endpoint to get/create session');

    // Call connect endpoint (POST) with full payload - this returns QR code
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/connect`,
      'POST',
      body  // Pass the full context (userId, any additional fields)
    );

    console.log('[WhatsApp QR] Backend response status:', response.statusCode);
    console.log('[WhatsApp QR] Backend response body:', response.body);

    // Parse the response to normalize it
    const payload = JSON.parse(response.body);
    
    // Normalize response format to ensure QR is at root level (like OPD app)
    const normalized = {
      qr: payload?.data?.qrCode || payload?.qrCode || payload?.qr,
      qrCode: payload?.data?.qrCode || payload?.qrCode || payload?.qr,
      sessionId: payload?.data?.sessionId || payload?.sessionId,
      message: payload?.message,
      success: payload?.success,
      ...payload
    };

    console.log('[WhatsApp QR] Normalized response - has QR:', !!normalized.qr);

    return ok(normalized);
  } catch (err) {
    console.error('[WhatsApp QR] Error:', err);
    return error('Failed to get QR code', 500);
  }
}, 'growth', 'whatsapp-qr', false);
