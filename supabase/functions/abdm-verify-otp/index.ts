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
  if (!res.ok) throw new Error(`Public key failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const pem: string = data.publicKey || data.certificate || data.PublicKey || data.Certificate;
  if (!pem) throw new Error(`Public key not found in response: ${JSON.stringify(data)}`);
  return pem;
}

async function rsaEncrypt(plaintext: string, pem: string, hash: 'SHA-1' | 'SHA-256'): Promise<string> {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'spki', binaryDer.buffer, { name: 'RSA-OAEP', hash }, false, ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, cryptoKey, new TextEncoder().encode(plaintext)
  );
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

function formatAbdmTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('-') + ' ' + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join(':');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { txnId, otp, patientId, clinicId, mobile } = await req.json();

    if (!txnId || !otp) {
      return jsonResponse({ error: 'txnId and otp are required' }, 400);
    }

    const X_CM_ID = Deno.env.get('ABDM_X_CM_ID') || 'sbx';
    const CLIENT_ID = Deno.env.get('ABDM_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('ABDM_CLIENT_SECRET');

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return jsonResponse({ error: 'ABDM credentials not configured' }, 500);
    }

    const accessToken = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

    const publicKeyPem = await getPublicKeyPem(accessToken, X_CM_ID);

    // ABDM spec: RSA/ECB/OAEPWithSHA-1AndMGF1Padding — encrypt raw OTP string, no pre-hashing
    const normalizedMobile = typeof mobile === 'string' ? mobile.trim() : '';
    const encryptedOtp = await rsaEncrypt(otp, publicKeyPem, 'SHA-1');

    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const currentTimestamp = formatAbdmTimestamp();

    const otpPayload: Record<string, string> = {
      timeStamp: currentTimestamp,
      txnId,
      otpValue: encryptedOtp
    };

    if (normalizedMobile) {
      otpPayload.mobile = normalizedMobile;
    }

    const requestBody = {
      authData: {
        authMethods: ['otp'],
        otp: otpPayload
      },
      consent: {
        code: 'abha-enrollment',
        version: '1.4'
      }
    };
    const abdmRes = await fetch('https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/enrol/byAadhaar', {
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
      console.error('[abdm-verify-otp] ABDM error:', abdmRes.status, errText);
      await supabase.from('abdm_audit_log').insert({
        patient_id: patientId || null,
        clinic_id: clinicId || null,
        action: 'otp_verify',
        request_id: requestId,
        status: 'failure',
        error_message: errText
      }).then(() => {}).catch(() => {});
      return jsonResponse({
        error: 'OTP verification failed',
        detail: errDetail,
        abdmStatus: abdmRes.status,
        requestMeta: {
          endpoint: '/v3/enrollment/enrol/byAadhaar',
          authMethods: requestBody.authData.authMethods,
          consent: requestBody.consent,
          mobileIncluded: Boolean(normalizedMobile),
          otpMode: 'raw-rsa-oaep'
        }
      }, abdmRes.status);
    }

    const abdmData = await abdmRes.json();

    await supabase.from('abdm_audit_log').insert({
      patient_id: patientId || null,
      clinic_id: clinicId || null,
      action: 'otp_verify',
      request_id: requestId,
      status: 'success'
    }).then(() => {}).catch(() => {});

    // X-token (user JWT) needed for profile fetch — capture all possible field names
    const xToken =
      abdmData.tokens?.token ||
      abdmData.token ||
      abdmData.xToken ||
      abdmData['X-token'] ||
      abdmData.jwtResponse?.token ||
      null;

    return jsonResponse({
      txnId: abdmData.txnId,
      authResult: abdmData.authResult,
      message: abdmData.message,
      xToken,
      // Return full data so frontend can log and we can see all fields
      _raw: abdmData
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[abdm-verify-otp] Error:', msg);
    return jsonResponse({ error: msg }, 500);
  }
});
