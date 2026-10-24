import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
type PublicUserRecord = {
  id?: string;
  auth_id?: string | null;
  username?: string | null;
  password_hash?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  name?: string | null;
  role?: string | null;
  clinic_name?: string | null;
  clinic_address?: string | null;
  gmb_link?: string | null;
  logo?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  languages?: unknown;
  default_language?: string | null;
  google_sheet_id?: string | null;
  google_apps_script_url?: string | null;
  enabled_features?: unknown;
  blueticks_api_key?: string | null;
  profile_types?: unknown;
  clinic_keywords?: string | null;
  business_context?: unknown;
};

type DatabaseWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: PublicUserRecord;
};

const DEFAULT_BACKEND_URL =
  'https://gmbreviewsystem.com/.netlify/functions/webhook-sync-user';

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRecord(payload: DatabaseWebhookPayload | PublicUserRecord): PublicUserRecord | null {
  if ('record' in payload || 'type' in payload || 'table' in payload || 'schema' in payload) {
    return payload.record || null;
  }

  return payload as PublicUserRecord;
}

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const configuredSecret = Deno.env.get('SYNC_USER_WEBHOOK_SECRET');
    const suppliedSecret = req.headers.get('x-webhook-secret');

    if (configuredSecret && suppliedSecret !== configuredSecret) {
      return jsonResponse({ success: false, error: 'Unauthorized webhook' }, 401);
    }

    const payload = await req.json() as DatabaseWebhookPayload | PublicUserRecord;
    const record = getRecord(payload);

    if (!record?.id) {
      return jsonResponse({ success: false, error: 'Webhook record.id is required' }, 400);
    }

    const username =
      record.username?.trim() ||
      record.contact_email?.trim().toLowerCase() ||
      record.id;
    const fullName =
      record.name?.trim() ||
      record.username?.trim() ||
      record.contact_email?.trim() ||
      record.id;
    const clinicName = record.clinic_name?.trim() || fullName;
    const contactEmail = record.contact_email?.trim() || username;

    // The application uses public.users.id for every WhatsApp backend request.
    const backendPayload = {
      userId: record.id,
      id: record.id,
      auth_id: record.auth_id || record.id,
      username,
      email: contactEmail,
      fullName,
      name: fullName,
      role: record.role || 'admin',
      clinicName,
      clinic_name: clinicName,
      clinicAddress: record.clinic_address || '',
      clinic_address: record.clinic_address || '',
      gmbLink: record.gmb_link || '',
      gmb_link: record.gmb_link || '',
      logo: record.logo || '',
      primaryColor: record.primary_color || '#4F46E5',
      primary_color: record.primary_color || '#4F46E5',
      secondaryColor: record.secondary_color || '#E5E7EB',
      secondary_color: record.secondary_color || '#E5E7EB',
      contactPhone: record.contact_phone || '',
      contact_phone: record.contact_phone || '',
      contactEmail,
      contact_email: contactEmail,
      contactWhatsapp: record.contact_whatsapp || record.contact_phone || '',
      contact_whatsapp: record.contact_whatsapp || record.contact_phone || '',
      languages: record.languages || null,
      defaultLanguage: record.default_language || 'en',
      default_language: record.default_language || 'en',
      enabledFeatures: record.enabled_features || [],
      enabled_features: record.enabled_features || [],
      profileTypes: record.profile_types || [],
      profile_types: record.profile_types || [],
      googleSheetId: record.google_sheet_id || '',
      google_sheet_id: record.google_sheet_id || '',
      googleAppsScriptUrl: record.google_apps_script_url || '',
      google_apps_script_url: record.google_apps_script_url || '',
      blueticksApiKey: record.blueticks_api_key || '',
      blueticks_api_key: record.blueticks_api_key || '',
      clinicKeywords: record.clinic_keywords || '',
      clinic_keywords: record.clinic_keywords || '',
      businessContext: record.business_context || null,
      business_context: record.business_context || null,
    };

    const backendUrl = Deno.env.get('WHATSAPP_USER_SYNC_URL') || DEFAULT_BACKEND_URL;
    const backendSecret = Deno.env.get('WHATSAPP_USER_SYNC_SECRET');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (backendSecret) {
      headers['x-webhook-secret'] = backendSecret;
    }

    console.log('Syncing public user to WhatsApp backend', {
      userId: record.id,
      username,
      clinicName,
      hasContactPhone: Boolean(record.contact_phone),
      hasContactWhatsapp: Boolean(record.contact_whatsapp),
      hasBackendSecret: Boolean(backendSecret),
    });

    const response = await runtimeFetch(backendUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(backendPayload),
    });

    const responseText = await response.text();
    let result: unknown = responseText;

    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Preserve non-JSON backend responses for diagnostics.
    }

    if (!response.ok) {
      console.error('WhatsApp backend user sync failed', {
        status: response.status,
        userId: record.id,
        result,
      });

      return jsonResponse({
        success: false,
        error: 'WhatsApp backend user sync failed',
        backendStatus: response.status,
        result,
      }, 502);
    }

    return jsonResponse({
      success: true,
      userId: record.id,
      result,
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('sync-user-to-neon failed', message);
    return jsonResponse({ success: false, error: message }, 500);
  }
}, 'growth', 'sync-user-to-neon'));
