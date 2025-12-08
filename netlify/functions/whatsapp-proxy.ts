import type { Handler } from '@netlify/functions';
import { corsHeaders, forwardToWhatsApp, ok, error, parseRequestBody } from './_shared/whatsappClient';

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body = parseRequestBody(event.body);
    if (!body.path) throw new Error('path is required for whatsapp-proxy.');

    const payload = await forwardToWhatsApp({
      path: body.path,
      method: body.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(body.headers || {}) },
      body: body.payload ? JSON.stringify(body.payload) : undefined
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to proxy WhatsApp request');
  }
};

export { handler };
