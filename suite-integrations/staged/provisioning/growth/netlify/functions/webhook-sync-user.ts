import { guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Webhook endpoint for DB-triggered user sync
 * POST /.netlify/functions/webhook-sync-user
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
    const configuredSecret = process.env.WHATSAPP_USER_SYNC_SECRET;
    const suppliedSecret = event.headers['x-webhook-secret'];

    if (configuredSecret && suppliedSecret !== configuredSecret) {
      return error('Unauthorized webhook', 401);
    }

    const body = parseRequestBody(event.body);

    const userId = body.userId || body.id || body.authId || body.auth_id;
    const authId = body.auth_id || body.authId || userId;
    const username = body.username || body.email;
    const fullName = body.fullName || body.name || body.full_name || username;
    const role = body.role || 'admin';

    if (!userId) {
      return error('Missing required field: userId', 400);
    }

    const backendUserId = await ensureUserExists(
      String(userId),
      body.email,
      fullName,
      {
        authId: String(authId),
        username,
        role,
      }
    );

    return ok({
      success: true,
      backendUserId,
      message: 'User synced to WhatsApp backend database',
    });
  } catch (err) {
    console.error('[Webhook Sync User] Error:', err);
    return error('Failed to sync user', 500);
  }
}, 'growth', 'webhook-sync-user', false);
