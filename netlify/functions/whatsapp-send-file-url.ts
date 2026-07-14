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

    if (!body.fileUrl) throw new Error('fileUrl is required.');
    if (!body.phone && !body.to) throw new Error('phone is required.');

    const authId = body.userId || body.authId || body.profileId;
    if (!authId) {
      return error('userId is required to send WhatsApp file', 400);
    }

    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const fileName = body.fileName || (() => {
      try {
        return decodeURIComponent(new URL(body.fileUrl).pathname.split('/').pop() || 'attachment.pdf');
      } catch {
        return 'attachment.pdf';
      }
    })();

    // The backend does not expose a per-user /whatsapp/send-file-url route.
    // URL-based documents are handled by the external reports endpoint.
    const payload = await forwardToWhatsApp({
      path: '/api/external/reports/send-url',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: backendUserId,
        phoneNumber: body.phone || body.to,
        fileUrl: body.fileUrl,
        caption: body.caption,
        fileName,
        templateData: body.templateData
      })
    });
    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to send WhatsApp file via URL');
  }
};

export { handler };
