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

    if (!body.fileBase64) throw new Error('fileBase64 is required.');
    if (!body.fileName) throw new Error('fileName is required.');
    if (!body.phone && !body.to) throw new Error('phone is required.');

    const authId = body.userId || body.authId || body.profileId;
    if (!authId) {
      return error('userId is required to send WhatsApp document', 400);
    }

    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const payload = await forwardToWhatsApp({
      path: `/api/users/${backendUserId}/whatsapp/send-document`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: body.phone || body.to,
        caption: body.caption,
        fileBase64: body.fileBase64,
        fileName: body.fileName,
        labId: body.labId || body.clinicId
      })
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to send WhatsApp document');
  }
};

export { handler };
