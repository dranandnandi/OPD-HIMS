import { withSuiteClient, runtimeFetch, guardEdge } from '../_shared/suite-runtime-guard.ts';
// Supabase Edge Function: send-push-notification
// Deploy with: supabase functions deploy send-push-notification

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  title: string;
  body: string;
  image?: string;
  data?: Record<string, string>;
  // Target options
  sendToAll?: boolean;
  userIds?: string[];
  tokens?: string[];
}

// Firebase service account credentials - set these as secrets
// supabase secrets set FIREBASE_PROJECT_ID=your-project-id
// supabase secrets set FIREBASE_CLIENT_EMAIL=your-client-email
// supabase secrets set FIREBASE_PRIVATE_KEY="your-private-key"

async function getAccessToken(): Promise<string> {
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID');
  const clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL');
  const privateKey = Deno.env.get('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase credentials not configured');
  }

  // Create JWT for Firebase
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  // Encode header and payload
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  // Sign with private key
  const signatureInput = `${headerB64}.${payloadB64}`;
  
  // Import private key
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  const pemContents = privateKey.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(signatureInput)
  );
  
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const jwt = `${signatureInput}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenResponse = await runtimeFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

async function sendFCMMessage(token: string, notification: NotificationPayload, accessToken: string): Promise<{ success: boolean; error?: string }> {
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID');
  
  const message = {
    message: {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.image && { image: notification.image }),
      },
      data: {
        title: notification.title,
        body: notification.body,
        ...(notification.image && { image: notification.image }),
        ...notification.data,
      },
      android: {
        notification: {
          ...(notification.image && { imageUrl: notification.image }),
          channelId: 'default',
        },
      },
    },
  };

  try {
    const response = await runtimeFetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    const result = await response.json();
    
    if (!response.ok) {
      return { success: false, error: result.error?.message || 'Unknown error' };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: NotificationPayload = await req.json();
    
    if (!payload.title || !payload.body) {
      return new Response(
        JSON.stringify({ error: 'title and body are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get FCM access token
    const accessToken = await getAccessToken();

    let tokens: string[] = [];

    if (payload.tokens && payload.tokens.length > 0) {
      // Use provided tokens
      tokens = payload.tokens;
    } else if (payload.userIds && payload.userIds.length > 0) {
      // Get tokens for specific users
      const { data, error } = await supabase
        .from('device_tokens')
        .select('fcm_token')
        .in('user_id', payload.userIds)
        .eq('is_active', true);
      
      if (error) throw error;
      tokens = data?.map(d => d.fcm_token) || [];
    } else if (payload.sendToAll) {
      // Get all active tokens
      const { data, error } = await supabase
        .from('device_tokens')
        .select('fcm_token')
        .eq('is_active', true);
      
      if (error) throw error;
      tokens = data?.map(d => d.fcm_token) || [];
    } else {
      return new Response(
        JSON.stringify({ error: 'Must specify tokens, userIds, or sendToAll' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No tokens found', sent: 0, failed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send to all tokens
    const results = await Promise.all(
      tokens.map(token => sendFCMMessage(token, payload, accessToken))
    );

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const errors = results.filter(r => !r.success).map(r => r.error);

    // Mark failed tokens as inactive (they might be invalid)
    const failedTokens = tokens.filter((_, i) => !results[i].success);
    if (failedTokens.length > 0) {
      await supabase
        .from('device_tokens')
        .update({ is_active: false })
        .in('fcm_token', failedTokens);
    }

    return new Response(
      JSON.stringify({ 
        message: `Notifications sent`, 
        total: tokens.length,
        sent, 
        failed,
        errors: errors.slice(0, 5) // Only return first 5 errors
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}, 'workforce', 'send-push-notification'));
