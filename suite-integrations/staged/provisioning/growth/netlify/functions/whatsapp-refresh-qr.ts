import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Refresh WhatsApp QR code (regenerate new QR)
 * POST /api/whatsapp-refresh-qr
 * Body: { userId: string }
 * 
 * This endpoint calls the backend's refresh-qr endpoint to get a new QR code
 * without affecting the current session.
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
    
    console.log('[WhatsApp Refresh QR] Received request for userId:', userId);
    
    if (!userId) {
      return error('Missing userId in request body', 400);
    }

    console.log('[WhatsApp Refresh QR] Calling refresh-qr endpoint');

    // Call refresh-qr endpoint (POST) to get a fresh QR code
    const response = await forwardToWhatsApp(
      `/api/users/${userId}/whatsapp/refresh-qr`,
      'POST',
      body
    );

    console.log('[WhatsApp Refresh QR] Backend response status:', response.statusCode);

    // Parse the response to normalize it
    const payload = JSON.parse(response.body);
    
    // Normalize response format to ensure QR is at root level
    const normalized = {
      qr: payload?.data?.qrCode || payload?.qrCode || payload?.qr,
      qrCode: payload?.data?.qrCode || payload?.qrCode || payload?.qr,
      sessionId: payload?.data?.sessionId || payload?.sessionId,
      message: payload?.message,
      success: payload?.success,
      ...payload
    };

    return ok(normalized);
  } catch (err) {
    console.error('[WhatsApp Refresh QR] Error:', err);
    return error('Failed to refresh QR code', 500);
  }
}, 'growth', 'whatsapp-refresh-qr', false);
