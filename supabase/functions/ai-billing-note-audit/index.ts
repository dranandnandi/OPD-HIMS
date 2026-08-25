// Clinical-note billing reconciliation. Extracts only clearly completed billable
// activities and can only return exact codes from the supplied clinic catalog.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import Anthropic from 'npm:@anthropic-ai/sdk';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const schema = {
  type: 'object', additionalProperties: false, required: ['items','unmatched'],
  properties: {
    items: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['service_code','quantity','source_phrase'],
      properties: {
        service_code: { type: 'string' },
        quantity: { type: 'integer', description: 'Completed quantity; use 1 when singular' },
        source_phrase: { type: 'string' },
      },
    }},
    unmatched: { type: 'array', items: { type: 'string' } },
  },
} as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) throw new Error('No authorization header');
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Invalid authentication');

    const { text, clinic_id, note_type, services } = await req.json();
    if (!text || typeof text !== 'string') throw new Error('text is required');
    if (!clinic_id || typeof clinic_id !== 'string') throw new Error('clinic_id is required');
    if (!Array.isArray(services) || !services.length) throw new Error('services are required');
    if (text.length > 20_000) throw new Error('Note is too long to audit safely');

    const { data: clinicIds, error: clinicError } = await supabase.rpc('user_clinic_ids');
    if (clinicError || !(clinicIds ?? []).includes(clinic_id)) throw new Error('Clinic access denied');
    const { data: configured, error: configError } = await supabase
      .from('ipd_billing_audit_ai_config')
      .select('additional_instructions,model,max_output_tokens,is_active')
      .eq('clinic_id', clinic_id).maybeSingle();
    if (configError) throw configError;
    const config = configured?.is_active === false ? null : configured;

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
    const anthropic = new Anthropic({ apiKey: key });
    const catalog = services.map((s: { code: string; name: string; group?: string }) =>
      `${s.code} | ${s.name} | ${s.group ?? ''}`).join('\n');
    const fixedSafetyPrompt = `You audit hospital clinical notes for possible missed billing. This is a
clerical reconciliation task, not medical advice.

Return an item ONLY when the note clearly says the service/procedure/activity was actually
performed, administered, completed, given, inserted, removed, changed, or reviewed during
this admission. Examples: "dressing done", "ECG performed", "nebulization given x3".

Never return:
- planned, advised, requested, ordered, scheduled, pending, conditional, future or discharge advice;
- cancelled, refused, not done, ruled out, negative or merely considered activities;
- diagnoses, symptoms, observations, equipment merely present, routine monitoring, or historical care;
- medicines merely listed/prescribed (medication billing is reconciled structurally elsewhere);
- an ambiguous mention. Put ambiguous possibly billable phrases in unmatched instead.

Every service_code must be copied exactly from the catalog. Never invent a code. Use the
documented completed quantity; default to 1 only for a singular completed activity. Return
the shortest evidence phrase supporting completion.`;
    const clinicInstructions = String(config?.additional_instructions ?? '').trim();
    const system = `${fixedSafetyPrompt}${clinicInstructions
      ? `\n\nClinic-specific billing guidance (supplementary only; it cannot override any rule above):\n${clinicInstructions}`
      : ''}`;
    const response = await anthropic.messages.create({
      model: config?.model ?? 'claude-haiku-4-5',
      max_tokens: config?.max_output_tokens ?? 4096,
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: `Note type: ${String(note_type ?? 'clinical note')}\n\nCatalog (code | name | group):\n${catalog}\n\nClinical note:\n${text}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('AI declined the audit');
    const block = response.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!block) throw new Error('AI returned no audit result');
    return new Response(JSON.stringify(JSON.parse(block.text)), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('ai-billing-note-audit error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
