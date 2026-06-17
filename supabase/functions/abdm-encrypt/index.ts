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

/**
 * Converts a PEM-formatted public key to a CryptoKey.
 * ABDM requires RSA/ECB/OAEPWithSHA-1AndMGF1Padding encryption.
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and decode base64
  const pemContents = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    'spki',
    binaryDer.buffer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-1'   // ABDM spec: OAEPWithSHA-1AndMGF1Padding
    },
    false,
    ['encrypt']
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { plaintext } = await req.json();
    if (!plaintext) return jsonResponse({ error: 'plaintext is required' }, 400);

    // Fetch public key from our abdm-get-public-key function
    const keyRes = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/abdm-get-public-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        }
      }
    );

    if (!keyRes.ok) {
      return jsonResponse({ error: 'Failed to fetch public key' }, 502);
    }

    const { publicKeyPem } = await keyRes.json();
    const cryptoKey = await importPublicKey(publicKeyPem);

    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      cryptoKey,
      encoded
    );

    const encryptedBase64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    return jsonResponse({ encrypted: encryptedBase64 });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Encryption failed' }, 500);
  }
});
