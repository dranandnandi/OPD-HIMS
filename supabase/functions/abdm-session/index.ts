import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const ABDM_BASE_URL = Deno.env.get('ABDM_BASE_URL') || 'https://dev.abdm.gov.in';
    const CLIENT_ID = Deno.env.get('ABDM_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('ABDM_CLIENT_SECRET');

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return jsonResponse({ error: 'ABDM credentials not configured' }, 500);
    }

    // Check for a cached non-expired token in Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: cached } = await supabase
      .from('_abdm_session')
      .select('access_token, expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.access_token) {
      return jsonResponse({ accessToken: cached.access_token });
    }

    // Fetch a fresh token from ABDM
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const res = await fetch(`${ABDM_BASE_URL}/api/hiecm/gateway/v3/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'REQUEST-ID': requestId,
        'TIMESTAMP': timestamp,
        'X-CM-ID': 'sbx'
      },
      body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, grantType: 'client_credentials' })
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonResponse({ error: 'ABDM session failed', detail: err }, 502);
    }

    const { accessToken, expiresIn } = await res.json();

    // Store token — subtract 60s to be safe before expiry
    const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();
    await supabase.from('_abdm_session').insert({ access_token: accessToken, expires_at: expiresAt });

    return jsonResponse({ accessToken });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
