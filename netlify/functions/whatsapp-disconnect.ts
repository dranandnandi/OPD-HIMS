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
    
    // Get userId (auth_id from OPD system)
    const authId = body.userId || body.authId || body.profileId;
    if (!authId) {
      return error('userId is required to disconnect WhatsApp', 400);
    }
    
    // Look up the WhatsApp backend user ID
    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const payload = await forwardToWhatsApp({
      path: `/api/users/${backendUserId}/whatsapp/disconnect`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: backendUserId,
        labId: body.labId || body.clinicId 
      })
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to disconnect WhatsApp');
  }
};

export { handler };
