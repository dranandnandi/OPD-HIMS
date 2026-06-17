import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const decodeBase64 = (value: string) => {
  const base64 = value.includes(',') ? value.split(',').pop() ?? '' : value;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ message: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ message: 'Upload service is not configured' }, 500);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData.user) {
      return json({ message: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const {
      clinicId,
      sequenceId,
      sequenceStage,
      conditionType,
      fileBase64,
      fileName,
      mimeType,
    } = body as Record<string, string>;

    if (!clinicId || !sequenceId || !fileBase64 || !fileName) {
      return json({ message: 'Missing required upload fields' }, 400);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `waiting-sequences/${clinicId}/${sequenceId}/${Date.now()}_${safeName}`;
    const bytes = decodeBase64(fileBase64);
    const contentType = mimeType || 'application/octet-stream';

    const { error: uploadError } = await serviceClient.storage
      .from('ocruploads')
      .upload(objectPath, bytes, {
        contentType,
        upsert: false,
        metadata: {
          clinicId,
          sequenceId,
          sequenceStage: sequenceStage || 'waiting',
          conditionType: conditionType || 'General',
          originalFileName: fileName,
          uploadedBy: userData.user.id,
          source: 'waiting_sequence',
        },
      });

    if (uploadError) {
      return json({ message: uploadError.message }, 400);
    }

    const { data: publicData } = serviceClient.storage
      .from('ocruploads')
      .getPublicUrl(objectPath);

    return json({
      bucket: 'ocruploads',
      path: objectPath,
      publicUrl: publicData.publicUrl,
      fileName,
      mimeType: contentType,
      size: bytes.byteLength,
    });
  } catch (error) {
    console.error('waiting-sequence-upload failed', error);
    return json({ message: error instanceof Error ? error.message : 'Upload failed' }, 500);
  }
});
