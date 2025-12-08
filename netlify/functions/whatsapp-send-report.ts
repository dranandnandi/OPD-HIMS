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

    if (!body.reportHtml && !body.reportPdfBase64) {
      throw new Error('Either reportHtml or reportPdfBase64 is required.');
    }
    if (!body.phone && !body.to) throw new Error('phone is required.');

    const authId = body.userId || body.authId || body.profileId;
    if (!authId) {
      return error('userId is required to send WhatsApp report', 400);
    }

    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const payload = await forwardToWhatsApp({
      path: `/api/users/${backendUserId}/whatsapp/send-report`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: body.phone || body.to,
        reportHtml: body.reportHtml,
        reportPdfBase64: body.reportPdfBase64,
        patient: body.patient,
        visit: body.visit,
        labId: body.labId || body.clinicId
      })
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to send WhatsApp report');
  }
};

export { handler };
