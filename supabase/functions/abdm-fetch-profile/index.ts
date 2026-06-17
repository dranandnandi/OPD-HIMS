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

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch('https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'REQUEST-ID': crypto.randomUUID(),
      'TIMESTAMP': new Date().toISOString(),
      'X-CM-ID': 'sbx'
    },
    body: JSON.stringify({ clientId, clientSecret, grantType: 'client_credentials' })
  });
  if (!res.ok) throw new Error(`Session failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  const token = body.accessToken || body.token || body.access_token;
  if (!token) throw new Error(`No token in response: ${JSON.stringify(body)}`);
  return token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { xToken, patientId, clinicId } = await req.json();

    if (!xToken) {
      return jsonResponse({ error: 'xToken (ABHA user token) is required' }, 400);
    }

    const X_CM_ID = Deno.env.get('ABDM_X_CM_ID') || 'sbx';
    const CLIENT_ID = Deno.env.get('ABDM_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('ABDM_CLIENT_SECRET');

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return jsonResponse({ error: 'ABDM credentials not configured' }, 500);
    }

    console.log('[abdm-fetch-profile] Getting access token...');
    const accessToken = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    console.log('[abdm-fetch-profile] Fetching ABHA profile...');
    const abdmRes = await fetch('https://abhasbx.abdm.gov.in/abha/api/v3/profile/account', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Token': `Bearer ${xToken}`,
        'REQUEST-ID': requestId,
        'TIMESTAMP': timestamp,
        'X-CM-ID': X_CM_ID
      }
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (!abdmRes.ok) {
      const errText = await abdmRes.text();
      console.error('[abdm-fetch-profile] Error:', abdmRes.status, errText);
      await supabase.from('abdm_audit_log').insert({
        patient_id: patientId || null,
        clinic_id: clinicId || null,
        action: 'profile_fetch',
        request_id: requestId,
        status: 'failure',
        error_message: errText
      }).then(() => {}).catch(() => {});
      return jsonResponse({ error: 'Failed to fetch ABHA profile', detail: errText, abdmStatus: abdmRes.status }, 502);
    }

    const abdmData = await abdmRes.json();
    console.log('[abdm-fetch-profile] Success, keys:', Object.keys(abdmData));

    await supabase.from('abdm_audit_log').insert({
      patient_id: patientId || null,
      clinic_id: clinicId || null,
      action: 'profile_fetch',
      request_id: requestId,
      status: 'success'
    }).then(() => {}).catch(() => {});

    const profile = {
      abhaNumber: abdmData.ABHANumber || abdmData.abhaNumber || abdmData.healthIdNumber,
      abhaAddress: abdmData.preferredAbhaAddress || abdmData.abhaAddress || abdmData.healthId,
      name: abdmData.name || `${(abdmData.firstName || '')} ${(abdmData.middleName || '')} ${(abdmData.lastName || '')}`.replace(/\s+/g, ' ').trim(),
      gender: abdmData.gender,
      yearOfBirth: abdmData.yearOfBirth,
      dayOfBirth: abdmData.dayOfBirth,
      monthOfBirth: abdmData.monthOfBirth,
      mobile: abdmData.mobile,
      email: abdmData.email,
      address: abdmData.address,
      stateName: abdmData.stateName,
      districtName: abdmData.districtName,
      pincode: abdmData.pincode,
      profilePhoto: abdmData.profilePhoto,
      kycVerified: abdmData.kycVerified,
      verificationStatus: abdmData.verificationStatus
    };

    return jsonResponse({ profile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[abdm-fetch-profile] Error:', msg);
    return jsonResponse({ error: msg }, 500);
  }
});
