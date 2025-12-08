import type { Handler } from '@netlify/functions';
import { corsHeaders, ensureLabContext, forwardToWhatsApp, ok, error, parseRequestBody } from './_shared/whatsappClient';
import { getUserIdFromAuthId } from './_shared/userLookup';

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body = parseRequestBody(event.body);
    ensureLabContext(body);

    if (!body.phone && !body.to) {
      throw new Error('phone is required to send a WhatsApp message.');
    }

    const authId = body.userId || body.authId || body.profileId;
    if (!authId) {
      return error('userId is required to send WhatsApp message', 400);
    }

    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const payload = await forwardToWhatsApp({
      path: `/api/users/${backendUserId}/whatsapp/send-message`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: body.phone || body.to,
        phone: body.phone || body.to,
        text: body.message,
        message: body.message,
        template: body.template,
        variables: body.variables,
        labId: body.labId || body.clinicId,
        channel: body.channel || 'OPD'
      })
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to send WhatsApp message');
  }
};

export { handler };
