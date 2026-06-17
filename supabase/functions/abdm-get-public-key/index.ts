import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Simple in-memory cache for the public key (valid for the function lifetime)
let cachedKey: { publicKeyPem: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Return cached key if still fresh
    if (cachedKey && Date.now() - cachedKey.fetchedAt < CACHE_TTL_MS) {
      return jsonResponse({ publicKeyPem: cachedKey.publicKeyPem });
    }

    const ABDM_BASE_URL = Deno.env.get('ABDM_BASE_URL') || 'https://dev.abdm.gov.in';
    const X_CM_ID = Deno.env.get('ABDM_X_CM_ID') || 'sbx';

    // Get Bearer token from abdm-session function
    const sessionRes = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/abdm-session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        }
      }
    );
    const { accessToken } = await sessionRes.json();

    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const res = await fetch(`${ABDM_BASE_URL}/v3/profile/public/certificate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'REQUEST-ID': requestId,
        'TIMESTAMP': timestamp,
        'X-CM-ID': X_CM_ID
      }
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonResponse({ error: 'Failed to fetch ABDM public key', detail: err }, 502);
    }

    const data = await res.json();
    // ABDM returns publicKey in PEM or base64 format depending on environment
    const publicKeyPem: string = data.publicKey || data.certificate || data;

    cachedKey = { publicKeyPem, fetchedAt: Date.now() };
    return jsonResponse({ publicKeyPem });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
