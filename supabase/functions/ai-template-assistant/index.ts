// AI Template Assistant — plain-English document template generation.
// "consent form for orthopedic surgery, English + Hindi headings" → template
// HTML using the app's {{placeholder}} keys, previewed in the Template Studio
// before the user saves it (RLS applies on save).
//
// Model: claude-haiku-4-5 (same as ai-masters-assistant; structured outputs
// guarantee valid JSON). Secret: ANTHROPIC_API_KEY (shared).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DOC_TYPES = [
  'discharge_summary', 'discharge_medication', 'admission_sheet', 'consent', 'ot_note',
  'death_summary', 'dama_form', 'referral_letter', 'estimate',
  'initial_assessment', 'case_sheet', 'nursing_chart',
];

const TEMPLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'doc_type', 'html_template', 'summary'],
  properties: {
    name: { type: 'string', description: 'Short template title, e.g. "Ortho Surgery Consent"' },
    doc_type: { type: 'string', enum: DOC_TYPES },
    html_template: { type: 'string', description: 'The template body HTML' },
    summary: { type: 'string', description: 'One sentence describing the generated template' },
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

    const { instruction, placeholders, current } = await req.json();
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

    const systemPrompt = `You write HTML document templates for a mid-size Indian hospital's inpatient
(IPD) system. Templates are edited in CKEditor and printed on the clinic's A4 letterhead
(the letterhead header/footer is added automatically — never include one).

Placeholder rules:
- Data is merged at generation time via {{key}} placeholders. Use ONLY keys from the
  provided list, written exactly as {{key}} — never invent keys.
- These keys expand to whole HTML blocks (tables/lists) and must sit on their own line,
  NOT inside a <p>: medications.discharge, medications.course, investigations.list, notes.course.
- Anything the doctor/staff must fill by hand goes in square brackets, e.g. [Operative findings].

HTML rules (CKEditor-safe):
- Allowed: <h2>, <h3>, <p>, <b>/<strong>, <i>, <u>, <ul>/<ol>/<li>, <br>,
  <table>/<tr>/<th>/<td> with simple inline styles (border, padding, width, text-align),
  <hr>. Nothing else — no scripts, images, divs, classes, or external CSS.
- Start with a centered <h2> document title. Keep section headings as <h3>.
- Follow the tone and structure of formal Indian hospital medico-legal documents.
- Consent/DAMA forms need declaration text, and signature lines for patient/attendant,
  witness, and doctor (name, relation, date/time) — use [brackets] for these, plus
  relevant {{patient.*}} / {{doctor.name}} placeholders.
- If the user asks for bilingual output, put the translation alongside or below the
  English text.

Behaviour:
- If a current template is provided, treat the request as a REVISION: keep everything
  that is not asked to change, and return the full revised html_template.
- Otherwise create a new template. Pick the best doc_type from the enum and a short name.
- summary: one short sentence describing what was generated or changed.`;

    const placeholderBlock = `Available placeholders (key — meaning):
${JSON.stringify(placeholders ?? [])}`;

    const currentBlock = current?.html
      ? `\n\nCurrent template being revised ("${current.name ?? ''}", type ${current.doc_type ?? '?'}):\n${current.html}`
      : '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      system: systemPrompt,
      output_config: {
        format: {
          type: 'json_schema',
          schema: TEMPLATE_SCHEMA,
        },
      },
      messages: [
        {
          role: 'user',
          content: `${placeholderBlock}${currentBlock}\n\nRequest: ${instruction}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('The AI declined this request.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Template too large — try a shorter or simpler request.');
    }

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const template = JSON.parse((textBlock as { text: string }).text);

    return new Response(JSON.stringify({ template }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ai-template-assistant error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
