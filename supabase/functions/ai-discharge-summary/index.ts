// AI Discharge Summary — turns the assembled IPD stay data into professional
// narrative sections for the discharge summary: a prose "Hospital Course",
// structured "Advice & Follow-up", and a "Condition at Discharge" line.
//
// It only rewrites the narrative sections. The structured tables (medications,
// investigations, vitals) are still built mechanically by the frontend from the
// chart, so nothing is fabricated. The model is told to use ONLY the facts
// provided and to leave a [bracketed] prompt where a required detail is missing.
//
// Model: claude-haiku-4-5 (fast/cheap; json_schema guarantees the shape).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hospital_course', 'advice_followup', 'condition_at_discharge'],
  properties: {
    hospital_course: {
      type: 'string',
      description:
        'HTML fragment (1–3 <p> paragraphs) narrating the clinical course: presentation, ' +
        'key findings, treatment given, response, and any consultations. Prose, not a ' +
        'timestamp dump. No markdown, no code fences.',
    },
    advice_followup: {
      type: 'string',
      description:
        'HTML fragment (a <ul> of concise bullet points) covering activity, diet/wound care ' +
        'as relevant, medications adherence, warning signs to return for, and the follow-up ' +
        'plan. Use [brackets] where a specific detail (e.g. follow-up date) is not provided.',
    },
    condition_at_discharge: {
      type: 'string',
      description:
        'A short plain-text phrase, e.g. "Stable, afebrile, tolerating orals" or ' +
        '"Stable". No HTML.',
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

    const { context } = await req.json();
    if (!context || typeof context !== 'object') {
      throw new Error('context (object) is required');
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      throw new Error(
        'ANTHROPIC_API_KEY secret is not configured. Run: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...'
      );
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const systemPrompt = `You are a physician writing the narrative sections of a hospital discharge
summary for an Indian hospital's inpatient department.

Strict rules:
- Use ONLY the facts provided in the stay data. Do NOT invent diagnoses, lab values,
  medications, dates, or events that are not present.
- Write in clear, professional clinical English suitable for a discharge summary.
- "hospital_course": synthesise the chronological notes, treatment plan entries,
  investigations and consultations into a flowing prose account (1–3 short paragraphs).
  Do not simply list timestamps; describe presentation, key findings, treatment and response.
- "advice_followup": a concise <ul> of actionable points (activity, diet/wound care where
  relevant, medication adherence, warning signs prompting return, and follow-up). Where a
  specific detail is not in the data (e.g. exact follow-up date), leave a [bracketed]
  placeholder for the doctor to complete rather than guessing.
- "condition_at_discharge": a short phrase based on the latest vitals/notes; default to
  "Stable" if unclear.
- Output HTML fragments only (no <html>/<body>, no markdown, no code fences). Keep it tight.`;

    const stay = JSON.stringify(context, null, 2);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      output_config: {
        format: {
          type: 'json_schema',
          schema: NARRATIVE_SCHEMA,
        },
      },
      messages: [
        {
          role: 'user',
          content: `Assembled stay data for this admission:\n\n${stay}\n\nWrite the discharge-summary narrative sections.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('The AI declined this request.');
    }

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const narrative = JSON.parse((textBlock as { text: string }).text);

    return new Response(JSON.stringify({ narrative }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ai-discharge-summary error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
