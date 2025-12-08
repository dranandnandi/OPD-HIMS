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
      return error('userId is required to check WhatsApp status', 400);
    }
    
    // Look up the WhatsApp backend user ID
    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const payload = await forwardToWhatsApp({
      path: `/api/users/${backendUserId}/whatsapp/status`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    // Normalize response: backend returns { success, data: { sessions: [...] } }
    // Frontend expects { connected, phoneNumber, sessionId, lastSyncAt }
    const sessions = payload?.data?.sessions || [];
    const activeSession = sessions.find((s: any) => s.isConnected) || sessions[0];
    
    const normalized = {
      connected: activeSession?.isConnected || false,
      phoneNumber: activeSession?.phoneNumber || null,
      sessionId: activeSession?.sessionId || null,
      businessName: activeSession?.businessName || null,
      lastSyncAt: activeSession?.lastActivity || null,
      startedAt: activeSession?.createdAt || null,
      queueSize: activeSession?.queueSize || 0,
      sessions: sessions, // Keep original sessions array for reference
      ...payload
    };

    return ok(normalized);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to fetch WhatsApp status');
  }
};

export { handler };
