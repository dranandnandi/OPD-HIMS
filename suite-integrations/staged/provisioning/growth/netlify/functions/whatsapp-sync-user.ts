import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Manually sync user to WhatsApp backend
 * POST /api/whatsapp-sync-user
 * Body: { userId: string, email: string, fullName: string }
 */

import { Handler } from '@netlify/functions';
import { forwardToWhatsApp, parseRequestBody, error, corsHeaders, ok } from './_shared/whatsappClient';
import { ensureUserExists } from './_shared/userLookup';

export const handler: Handler = guardNetlify(async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return error('Method not allowed', 405);
  }

  try {
    const body = parseRequestBody(event.body);
    const userId = body.userId || body.id || body.authId || body.auth_id;
    const authId = body.auth_id || body.authId || userId;
    const email = body.email || body.username;
    const fullName = body.fullName || body.name || body.full_name || email || userId;
    const role = body.role || 'admin';

    if (!userId) {
      return error('Missing required field: userId', 400);
    }

    // Ensure user exists in WhatsApp database
    const backendUserId = await ensureUserExists(String(userId), email, fullName, {
      authId: String(authId),
      username: body.username,
      role,
    });

    // Sync to backend
    const response = await forwardToWhatsApp(
      `/api/users/${backendUserId}/sync`,
      'POST',
      { username: email || body.username || backendUserId, full_name: fullName }
    );

    return response;
  } catch (err) {
    console.error('[WhatsApp Sync User] Error:', err);
    return error('Failed to sync user', 500);
  }
}, 'growth', 'whatsapp-sync-user', false);
