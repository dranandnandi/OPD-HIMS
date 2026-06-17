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

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Step A: Get ABDM Bearer token ─────────────────────────────────────────────
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ABDM session failed (${res.status}): ${err}`);
  }

  const body = await res.json();
  const token = body.accessToken || body.token || body.access_token;
  if (!token) throw new Error(`No token in session response: ${JSON.stringify(body)}`);
  return token;
}

// ── Step B: Fetch ABDM RSA public key ─────────────────────────────────────────
async function getPublicKeyPem(accessToken: string, xCmId: string): Promise<string> {
  const res = await fetch('https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'REQUEST-ID': crypto.randomUUID(),
      'TIMESTAMP': new Date().toISOString(),
      'X-CM-ID': xCmId
    }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ABDM public key fetch failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const pem: string = data.publicKey || data.certificate || data.PublicKey || data.Certificate;
  if (!pem) throw new Error(`Public key field not found: ${JSON.stringify(data)}`);
  return pem;
}

// ── Step C: RSA-OAEP/SHA-1 encrypt (ABDM spec) ───────────────────────────────
async function encryptValue(plaintext: string, pemOrBase64: string): Promise<string> {
  const b64 = pemOrBase64
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  const binaryDer = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-1' },
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    cryptoKey,
    new TextEncoder().encode(plaintext)
  );

  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { aadhaar, patientId, clinicId } = await req.json();

    if (!aadhaar || !/^\d{12}$/.test(aadhaar)) {
      return jsonResponse({ error: 'Valid 12-digit Aadhaar number is required' }, 400);
    }

    const X_CM_ID = Deno.env.get('ABDM_X_CM_ID') || 'sbx';
    const CLIENT_ID = Deno.env.get('ABDM_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('ABDM_CLIENT_SECRET');

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return jsonResponse({ error: 'ABDM credentials not configured in Supabase secrets' }, 500);
    }

    // A. Get Bearer token (gateway)
    const accessToken = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
    const publicKeyPem = await getPublicKeyPem(accessToken, X_CM_ID);
    const encryptedAadhaar = await encryptValue(aadhaar, publicKeyPem);

    // D. Request OTP — Aadhaar enrollment flow
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const requestBody = {
      txnId: '',
      // Aadhaar OTP request should use only the enrolment scope.
      // Adding "mobile-verify" makes ABDM validate this as a mobile flow.
      scope: ['abha-enrol'],
      loginHint: 'aadhaar',
      loginId: encryptedAadhaar,
      otpSystem: 'aadhaar'
    };

    const abdmRes = await fetch('https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/request/otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'REQUEST-ID': requestId,
        'TIMESTAMP': timestamp,
        'X-CM-ID': X_CM_ID
      },
      body: JSON.stringify(requestBody)
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (!abdmRes.ok) {
      const errText = await abdmRes.text();
      const errDetail = parseJsonSafely(errText);
      console.error('[abdm-request-otp] ABDM error:', abdmRes.status, errText);
      await supabase.from('abdm_audit_log').insert({
        patient_id: patientId || null,
        clinic_id: clinicId || null,
        action: 'otp_request',
        request_id: requestId,
        status: 'failure',
        error_message: errText
      }).then(() => {}).catch(() => {});
      return jsonResponse({
        error: 'ABDM OTP request failed',
        detail: errDetail,
        abdmStatus: abdmRes.status,
        requestMeta: {
          endpoint: '/v3/enrollment/request/otp',
          scope: requestBody.scope,
          loginHint: requestBody.loginHint,
          otpSystem: requestBody.otpSystem
        }
      }, abdmRes.status);
    }

    const abdmBody = await abdmRes.json();
    const txnId = abdmBody.txnId || abdmBody.transactionId;

    await supabase.from('abdm_audit_log').insert({
      patient_id: patientId || null,
      clinic_id: clinicId || null,
      action: 'otp_request',
      request_id: requestId,
      status: 'success'
    }).then(() => {}).catch(() => {});

    return jsonResponse({ txnId });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[abdm-request-otp] Caught error:', msg);
    return jsonResponse({ error: msg }, 500);
  }
});
