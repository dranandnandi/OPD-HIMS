import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Sync user to WhatsApp database on login
 * POST /api/sync-user-to-whatsapp-db
 * Body: { userId: string, email: string, fullName: string }
 */

import { Handler } from '@netlify/functions';
import { parseRequestBody, error, ok, corsHeaders } from './_shared/whatsappClient';
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

    return ok({
      success: true,
      backendUserId,
      message: 'User synced successfully',
    });
  } catch (err) {
    console.error('[Sync User to WhatsApp DB] Error:', err);
    return error('Failed to sync user to database', 500);
  }
}, 'growth', 'sync-user-to-whatsapp-db', false);
