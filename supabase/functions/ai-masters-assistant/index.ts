// AI Masters Assistant — plain-English hospital master-data creation.
// "5 beds in general, 7 in twin sharing on 2nd floor" → structured plan JSON
// that the frontend previews and creates via the normal services (RLS applies).
//
// Model: claude-haiku-4-5 (fast/cheap; structured outputs guarantee valid JSON).
// The plan schema is enforced server-side via output_config.format json_schema.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Plan schema — structured outputs (all objects: additionalProperties false,
// every key required; optionality expressed via null union types)
// ---------------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'wards', 'bed_types', 'beds', 'services', 'service_class_rates', 'packages'],
  properties: {
    summary: { type: 'string', description: 'One-sentence recap of what will be created' },
    wards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'floor', 'ward_type'],
        properties: {
          name: { type: 'string' },
          floor: { type: ['string', 'null'] },
          ward_type: {
            type: 'string',
            enum: ['general', 'private', 'icu', 'hdu', 'maternity', 'pediatric', 'isolation'],
          },
        },
      },
    },
    bed_types: {
      type: 'array',
      description: 'New bed classes to create (only when not already existing)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'name', 'daily_rent', 'rate_multiplier', 'is_critical_care'],
        properties: {
          code: { type: 'string', description: 'Short uppercase code, e.g. TWIN' },
          name: { type: 'string' },
          daily_rent: { type: 'number', description: 'Daily room rent in INR' },
          rate_multiplier: { type: 'number', description: 'Service rate multiplier for this class, 1 = base' },
          is_critical_care: { type: 'boolean' },
        },
      },
    },
    beds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ward_name', 'bed_type', 'count', 'number_prefix', 'start_number'],
        properties: {
          ward_name: { type: 'string', description: 'Must match an existing or newly created ward name' },
          bed_type: { type: 'string', description: 'Bed class name or code (existing or newly created)' },
          count: { type: 'integer' },
          number_prefix: { type: 'string', description: 'Bed number prefix, e.g. "G-" or "T-"' },
          start_number: { type: 'integer' },
        },
      },
    },
    services: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service_code', 'name', 'charge_group_code', 'price', 'cost', 'is_sharable'],
        properties: {
          service_code: { type: 'string' },
          name: { type: 'string' },
          charge_group_code: { type: 'string', description: 'Existing charge group code from context' },
          price: { type: 'number' },
          cost: { type: ['number', 'null'] },
          is_sharable: { type: 'boolean', description: 'Doctor share applies' },
        },
      },
    },
    service_class_rates: {
      type: 'array',
      description: 'Explicit bed-class rates for services (overrides the class multiplier)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service_code', 'bed_type', 'rate'],
        properties: {
          service_code: { type: 'string', description: 'Existing service code from context, or one created in this plan' },
          bed_type: { type: 'string', description: 'Bed class name or code from context' },
          rate: { type: 'number', description: 'Rate in INR for that class' },
        },
      },
    },
    packages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name', 'price', 'estimated_cost', 'stay_days', 'per_day_bed_cap',
          'implant_cap', 'inclusions', 'exclusions', 'class_prices',
        ],
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          estimated_cost: { type: ['number', 'null'] },
          stay_days: { type: ['integer', 'null'] },
          per_day_bed_cap: { type: ['number', 'null'] },
          implant_cap: { type: ['number', 'null'] },
          inclusions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['charge_group_code', 'service_code', 'bed_type', 'max_amount', 'max_quantity'],
              properties: {
                charge_group_code: { type: ['string', 'null'], description: 'Group grain (use this OR service_code)' },
                service_code: { type: ['string', 'null'] },
                bed_type: { type: ['string', 'null'], description: 'Bed class this cap applies to; null = all classes' },
                max_amount: { type: ['number', 'null'] },
                max_quantity: { type: ['number', 'null'] },
              },
            },
          },
          exclusions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['charge_group_code', 'service_code'],
              properties: {
                charge_group_code: { type: ['string', 'null'] },
                service_code: { type: ['string', 'null'] },
              },
            },
          },
          class_prices: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['bed_type', 'price'],
              properties: {
                bed_type: { type: 'string' },
                price: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
} as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- auth: only signed-in clinic users may call this -------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Invalid authentication');

    const { instruction, context } = await req.json();
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('instruction (string) is required');
    }

    // --- Claude call --------------------------------------------------------
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      throw new Error(
        'ANTHROPIC_API_KEY secret is not configured. Run: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...'
      );
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const systemPrompt = `You convert a hospital administrator's plain-English request into a structured
master-data creation plan for an Indian hospital IPD system.

Rules:
- Create ONLY what the request asks for. Arrays for entity types not mentioned must be empty.
- Reuse existing entities from the context whenever they match (case-insensitive); only add
  bed_types/wards that do not already exist.
- Bed numbering: sensible prefix from the ward/class name ("General Ward A" -> "G-",
  "Twin Sharing" -> "T-"), start_number 1 unless told otherwise.
- Prices are INR. If a rent/price is not given, estimate a realistic mid-size Indian
  hospital figure (General ~1500/day, Twin/Semi ~2500, Private ~4000, Suite ~6000, ICU ~7500).
- rate_multiplier: General 1.0, Twin/Semi ~1.15, Private ~1.3, Suite ~1.5, ICU 1.0
  (ICU services are usually explicitly priced) unless told otherwise.
- Services must use one of the existing charge group codes from context.
- Class-specific service rates ("x-ray 1200 in private", "dressing 500 for ICU class"):
  use service_class_rates with the EXISTING service_code from context (match by name,
  case-insensitive) or a service being created in this plan. Do NOT create a duplicate
  service just to set a class rate. Bed classes without an explicit rate bill at
  base price × the class multiplier shown in context.
- Package inclusions/exclusions: use group grain (charge_group_code) unless a specific
  service is named. Class-specific limits use one inclusion row per bed class.
- summary: one short sentence describing the plan.`;

    const contextBlock = `Existing masters in this clinic:
Charge groups (code — name): ${JSON.stringify(context?.chargeGroups ?? [])}
Bed classes (code — name — rate multiplier): ${JSON.stringify(context?.bedTypes ?? [])}
Wards: ${JSON.stringify(context?.wards ?? [])}
Services (code — name — base price): ${JSON.stringify(context?.services ?? [])}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      output_config: {
        format: {
          type: 'json_schema',
          schema: PLAN_SCHEMA,
        },
      },
      messages: [
        {
          role: 'user',
          content: `${contextBlock}\n\nRequest: ${instruction}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('The AI declined this request.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Plan too large — try splitting the request into smaller parts.');
    }

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const plan = JSON.parse((textBlock as { text: string }).text);

    return new Response(JSON.stringify({ plan }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ai-masters-assistant error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
