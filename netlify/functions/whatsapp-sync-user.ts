import type { Handler } from '@netlify/functions';
import { corsHeaders, ensureLabContext, forwardToWhatsApp, ok, error, parseRequestBody } from './_shared/whatsappClient';

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body = parseRequestBody(event.body);
    ensureLabContext(body);

    if (!body.user) throw new Error('user payload is required.');

    const payload = await forwardToWhatsApp({
      path: '/api/whatsapp/sync-user',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to sync user to WhatsApp');
  }
};

export { handler };
