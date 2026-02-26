// netlify/functions/whatsapp-send-bill.js
// Sends invoice PDF via WhatsApp using /api/external/reports/send-url

import { getUserIdFromAuthId } from './_shared/userLookup.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const getBaseUrl = (event) => {
  const proto =
    event.headers?.['x-forwarded-proto'] ||
    event.headers?.['X-Forwarded-Proto'] ||
    'https';
  const host =
    event.headers?.host ||
    event.headers?.Host ||
    process.env.URL?.replace(/^https?:\/\//, '') ||
    '';
  return host ? `${proto}://${host}` : '';
};

const isSessionNotFoundError = (value) => {
  const text = JSON.stringify(value || {}).toLowerCase();
  return text.includes('session_not_found') || text.includes('session not found');
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  try {
    const contentType = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return json(400, { success: false, error: 'Content-Type must be application/json' });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const {
      userId,
      username,
      phoneNumber,
      phone,
      fileUrl,
      caption,
      fileName,
      billNumber,
      patientName,
      totalAmount,
      sessionId,
      templateData,
    } = body;

    // In OPD flows, userId is auth_id. Map it to backend WhatsApp user id first.
    const authOrBackendUserId = userId ? String(userId) : null;
    const mappedBackendUserId = authOrBackendUserId
      ? await getUserIdFromAuthId(authOrBackendUserId)
      : null;

    // Prefer mapped backend UUID; if mapping is missing, try incoming userId directly, then username.
    const primaryUserIdentifier = mappedBackendUserId || authOrBackendUserId || username;
    if (!primaryUserIdentifier) {
      return json(400, {
        success: false,
        error: 'userId or username is required',
      });
    }

    if (!fileUrl) return json(400, { success: false, error: 'fileUrl is required' });

    let resolvedPhone = phoneNumber || phone || null;
    if (!resolvedPhone) {
      return json(400, { success: false, error: 'phoneNumber or phone is required' });
    }

    // Normalize phone and ensure India country code prefix
    resolvedPhone = String(resolvedPhone).replace(/\D/g, '');
    if (resolvedPhone.startsWith('0') && resolvedPhone.length === 11) {
      resolvedPhone = resolvedPhone.slice(1);
    }
    if (!resolvedPhone.startsWith('91')) {
      resolvedPhone = `91${resolvedPhone}`;
    }

    let finalCaption = caption;
    if (!finalCaption && patientName && billNumber && totalAmount !== undefined) {
      finalCaption = `Hello ${patientName},\n\nThank you for your visit!\n\nYour bill ${billNumber} for Rs ${totalAmount} is attached.\n\nPlease find your invoice attached.`;
    } else if (!finalCaption) {
      finalCaption = 'Your invoice is attached.';
    }

    const payload = {
      userId: primaryUserIdentifier,
      phoneNumber: resolvedPhone,
      fileUrl,
      caption: finalCaption,
      fileName: fileName || `bill_${billNumber || 'invoice'}.pdf`,
      ...(sessionId ? { sessionId } : {}),
      ...(templateData ? { templateData } : {}),
    };

    const baseUrl = getBaseUrl(event);
    if (!baseUrl) {
      return json(500, { success: false, error: 'Unable to resolve function base URL' });
    }

    // Must match backend apiKeyAuth
    const apiKey = process.env.WHATSAPP_API_KEY;
    if (!apiKey) {
      return json(500, {
        success: false,
        error: 'Missing WHATSAPP_API_KEY env var for external API authentication',
      });
    }

    const callExternal = async (identifier) =>
      fetch(`${baseUrl}/.netlify/functions/whatsapp-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/api/external/reports/send-url',
          method: 'POST',
          payload: { ...payload, userId: identifier },
        }),
      });

    let upstream = await callExternal(primaryUserIdentifier);
    let text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: upstream.ok, raw: text };
    }

    // Fallback retries only for session mismatch cases.
    const fallbackIdentifiers = [];
    if (authOrBackendUserId && authOrBackendUserId !== primaryUserIdentifier) {
      fallbackIdentifiers.push(authOrBackendUserId);
    }
    if (username && username !== primaryUserIdentifier && username !== authOrBackendUserId) {
      fallbackIdentifiers.push(username);
    }

    if (!upstream.ok && isSessionNotFoundError(data)) {
      for (const fallbackId of fallbackIdentifiers) {
        upstream = await callExternal(fallbackId);
        text = await upstream.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { success: upstream.ok, raw: text };
        }

        if (upstream.ok || !isSessionNotFoundError(data)) {
          break;
        }
      }
    }

    if (!upstream.ok) {
      return json(upstream.status, {
        success: false,
        error: data?.error || data?.message || 'Failed to send WhatsApp bill',
        details: data,
      });
    }

    return json(200, data);
  } catch (err) {
    console.error('Handler error:', err && err.stack ? err.stack : String(err));
    return json(500, {
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? String(err) : undefined,
    });
  }
};
