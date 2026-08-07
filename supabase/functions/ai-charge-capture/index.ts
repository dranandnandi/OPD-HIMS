// AI Charge Capture — a billing utility (NOT clinical decision support).
//
// Front-desk / nurse types or dictates plain language like
//   "two dressings, one ECG, chest x-ray and a physician round"
// and this matches each phrase to an EXISTING service in the clinic's
// services_master (by code/name/synonym), returning the service_code + quantity.
// The frontend then resolves the tariff rate, shows a review list, and posts.
//
// It never invents a service_code — anything it can't match is returned in
// `unmatched` for the user to add manually. No medical reasoning is performed.
//
// Model: claude-haiku-4-5 (fast/cheap; json_schema guarantees the shape).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CAPTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'unmatched'],
  properties: {
    items: {
      type: 'array',
      description: 'One entry per service the user clearly intends to charge',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service_code', 'quantity', 'source_phrase'],
        properties: {
          service_code: {
            type: 'string',
            description: 'MUST be an exact service_code from the provided catalog',
          },
          quantity: { type: 'integer', description: 'Quantity, default 1' },
          source_phrase: {
            type: 'string',
            description: 'The words from the input this match came from',
          },
        },
      },
    },
    unmatched: {
      type: 'array',
      description: 'Phrases that could not be confidently matched to a catalog service',
      items: { type: 'string' },
    },
  },
} as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Invalid authentication');

    const { text, services } = await req.json();
    if (!text || typeof text !== 'string') throw new Error('text (string) is required');
    if (!Array.isArray(services) || services.length === 0) {
      throw new Error('services (non-empty array) is required');
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      throw new Error(
        'ANTHROPIC_API_KEY secret is not configured. Run: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...'
      );
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const systemPrompt = `You are a hospital billing assistant. Match the user's free-text or dictated
list of services/items to EXISTING services from the provided catalog so they can be posted
as charges. This is a clerical matching task, not medical advice.

Strict rules:
- "service_code" in every item MUST be copied exactly from the catalog. Never invent a code.
- Match on code, name, common abbreviations/synonyms (ECG=electrocardiogram, CBC=complete
  blood count, X-ray/CXR=radiograph, USG=ultrasound, IVF=IV fluids, inj=injection, etc.).
- Read quantities from words/numbers ("two dressings"=2, "x3", "thrice"=3). Default 1.
- If a phrase is ambiguous or has no good catalog match, DO NOT guess — put the phrase text
  in "unmatched".
- Ignore chit-chat and words that are not billable items.`;

    const catalogBlock = `Service catalog (service_code | name | group):
${services
  .map((s: { code: string; name: string; group?: string }) => `${s.code} | ${s.name} | ${s.group ?? ''}`)
  .join('\n')}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      output_config: { format: { type: 'json_schema', schema: CAPTURE_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `${catalogBlock}\n\nUser input: "${text}"\n\nMatch to catalog services.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const result = JSON.parse((textBlock as { text: string }).text);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ai-charge-capture error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
