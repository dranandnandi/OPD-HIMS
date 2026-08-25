// AI Document Assist — "Write with AI" in the IPD Documents tab.
//
// The clinician types a one-liner about the case ("typhoid fever, 5 days,
// conservative management") and this composes the document that is open in
// front of them: prose for each of its own headings, plus — for an estimate —
// a costed line list built from THIS clinic's real tariff.
//
// Two hard boundaries keep it safe to use for money:
//   1. It never invents a service_code. Priced lines must quote a code from
//      the catalog that was sent in; the app resolves the rupee figure from
//      its own rate card, so the model never does the arithmetic.
//   2. Lines the app cannot price from the catalog (pharmacy, consumables)
//      carry an explicit estimated unit_rate and are flagged as estimates.
//
// It also reports which of the document's sections do not apply to this case
// (OT charges / implants on a purely medical admission), so they can be
// dropped from the draft instead of printing as empty rows.
//
// Model: claude-haiku-4-5 (same as the other AI helpers). Secret: ANTHROPIC_API_KEY.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LINE_CATEGORIES = [
  'bed', 'nursing', 'consultation', 'lab', 'imaging', 'procedure', 'surgery',
  'pharmacy', 'consumable', 'implant', 'equipment', 'misc',
];

const ASSIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'remove_sections', 'estimate', 'summary'],
  properties: {
    sections: {
      type: 'array',
      description: 'Prose written into the document\'s own headings. Omit headings you have nothing for.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field_id', 'heading', 'text', 'mode'],
        properties: {
          field_id: {
            type: 'string',
            description: 'A section id from the list supplied, or "new" for a section the document lacks',
          },
          heading: {
            type: 'string',
            description: 'Heading to create — only when field_id is "new", else empty string',
          },
          text: {
            type: 'string',
            description: 'Finished prose for that section. Lines starting "- " render as bullets.',
          },
          mode: { type: 'string', enum: ['replace', 'append'] },
        },
      },
    },
    remove_sections: {
      type: 'array',
      description:
        'Sections of this document that do not apply to this case and should be deleted '
        + '(e.g. surgery/OT/implant sections for a purely medical admission). Never list a '
        + 'section you also wrote into, and never list a mandatory medico-legal section.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field_id', 'reason'],
        properties: {
          field_id: { type: 'string', description: 'A section id from the list supplied' },
          reason: { type: 'string', description: 'Short reason it does not apply' },
        },
      },
    },
    estimate: {
      type: 'object',
      additionalProperties: false,
      required: ['applicable', 'stay_days', 'lines', 'assumptions', 'excluded'],
      description: 'The costing. Set applicable=false for any document that is not an estimate.',
      properties: {
        applicable: { type: 'boolean' },
        stay_days: {
          type: 'integer',
          description: 'Expected length of stay in days for this condition and plan',
        },
        lines: {
          type: 'array',
          description: 'One line per chargeable head. Ordered bed → nursing → consultation → investigations → procedures → pharmacy/consumables → other.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'service_code', 'category', 'unit_rate', 'quantity', 'per_day', 'note'],
            properties: {
              label: { type: 'string', description: 'How the line prints on the estimate' },
              service_code: {
                type: 'string',
                description:
                  'EXACT service_code from the supplied catalog, or empty string when no catalog '
                  + 'service fits (then unit_rate must be your own estimate)',
              },
              category: { type: 'string', enum: LINE_CATEGORIES },
              unit_rate: {
                type: 'number',
                description:
                  'Leave 0 when service_code is set — the app fills the tariff rate. When '
                  + 'service_code is empty, your estimated rupee rate per unit (per day if per_day).',
              },
              quantity: {
                type: 'number',
                description: 'Units per day when per_day is true, else total units for the stay',
              },
              per_day: {
                type: 'boolean',
                description: 'true when the line recurs every day of stay (bed, nursing, daily round)',
              },
              note: { type: 'string', description: 'Short qualifier, e.g. "1 visit/day", "if required"' },
            },
          },
        },
        assumptions: {
          type: 'string',
          description: 'What this quote assumes — uncomplicated course, bed class, exclusions',
        },
        excluded: {
          type: 'array',
          description: 'Heads deliberately left out because they do not apply to this case',
          items: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', description: 'One sentence describing what was drafted' },
  },
} as const;

interface Field { id: string; label: string; currentText?: string }
interface CatalogItem { code: string; name: string; type: string; unit?: string; rate: number }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- auth: only signed-in clinic users may call this ---------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Invalid authentication');

    const { instruction, document, patient, tariff } = await req.json();
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('instruction (string) is required');
    }
    const fields: Field[] = Array.isArray(document?.fields) ? document.fields : [];
    if (fields.length === 0) {
      throw new Error('document.fields is required — the document has no sections to write into');
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      throw new Error(
        'ANTHROPIC_API_KEY secret is not configured. Run: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...'
      );
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const isEstimate = Boolean(tariff);
    const catalog: CatalogItem[] = Array.isArray(tariff?.catalog) ? tariff.catalog : [];

    const systemPrompt = `You are a senior medical officer and billing head at a mid-size Indian hospital,
drafting an inpatient document for a clinician who has given you a one-line brief. Write the
document the way that hospital's own consultants write it: concise, factual, in Indian clinical
register, ready to print after a read-through.

WHAT YOU PRODUCE
- "sections": finished prose for the document's OWN headings, using only the section ids listed.
  Write nothing for a heading you have no basis for. Do not repeat the heading inside the text.
  Use "- " at the start of a line for a bullet (drugs, advice points, cost qualifiers).
  Use mode "replace" for an empty or placeholder section, "append" only to add to real content.
- "remove_sections": headings that genuinely do not apply to this case, so they are not printed
  empty. Typical: OT / surgery / anaesthesia / implant sections for a purely medical admission.
  NEVER remove a section you wrote into, and never remove consent, declaration, disclaimer or
  signature sections — those are medico-legal and always stay.
- "summary": one sentence on what you drafted.

CLINICAL HONESTY
- Everything you write is a DRAFT for the treating doctor to verify. Stay within what the brief,
  the diagnosis and the chart context support. Do not invent examination findings, lab values,
  drug doses or dates that were not given. Where a specific is needed but unknown, write it in
  [square brackets] so the doctor fills it in.
- Prefer standard Indian management of the stated condition — the usual drug classes,
  investigations and duration — described at the level of a plan, not a prescription.`;

    const estimateRules = `
THE ESTIMATE (this document is a cost estimate — set estimate.applicable = true)
This is the part the patient's family decides on, so it must be realistic and it must be built
from the hospital's OWN rate card, not from guessed prices.

1. LENGTH OF STAY: pick the usual stay for this condition treated this way at a mid-size Indian
   hospital, unless the brief states a duration — if it does, use that.
2. LINES: quote a "service_code" copied EXACTLY from the catalog below for everything the catalog
   covers — bed/room rent, nursing, consultant visits, investigations, procedures, oxygen,
   physiotherapy. Leave unit_rate 0 on those: the app fills the real class-wise rate itself.
   The bed line MUST use the room-rent service of the admitted bed class shown below.
3. Only when NOTHING in the catalog fits (typically pharmacy, IV fluids, consumables, disposables)
   leave service_code empty and give your own unit_rate. Set per_day = true and quantity = 1 for
   those, so the rate reads as "per day".
4. per_day = true for anything that recurs daily (bed, nursing, daily consultant round, monitoring,
   pharmacy). quantity is then units PER DAY. For one-off items (an admission charge, one X-ray,
   one procedure) set per_day = false and quantity = total units for the whole stay.
5. REALISM CHECK — the most important rule. The daily benchmark below is what this hospital
   actually bills per patient-day. Your per-day total (bed + nursing + consultation + a fair share
   of investigations + pharmacy + consumables) must land in that band. If your lines add up far
   outside it, adjust the ESTIMATED lines (pharmacy, consumables) and the investigation frequency
   until they do — never adjust a catalog rate, and never pad the list with items the case does
   not need.
6. LEAVE OUT what the case does not need. A medical admission has no OT charge, no surgeon fee,
   no anaesthesia, no implant. List those in "excluded" instead of quoting them at zero.
   Conversely, a surgical brief must include OT, surgeon, anaesthetist and implant lines.
7. "assumptions": bed class quoted, expected stay, that this is an approximate pre-admission
   estimate for an uncomplicated course, and what would change it (ICU shift, longer stay,
   complications, blood products). One short paragraph.
8. Also write the narrative sections of the estimate normally — diagnosis, proposed treatment,
   expected stay, and a notes/disclaimer section. Do NOT try to write the cost table as prose in
   a section: the app renders the table from your "lines".`;

    const nonEstimateRules = `
This document is NOT a cost estimate — set estimate.applicable = false, stay_days 0, lines [],
excluded [] and assumptions "".`;

    const catalogBlock = isEstimate
      ? `
ADMITTED BED CLASS: ${tariff.bedClass?.name ?? 'not allotted'}${
          tariff.bedClass?.dailyRent
            ? ` — room rent ₹${tariff.bedClass.dailyRent}/day (service ${tariff.bedClass.roomRentCode ?? '?'})`
            : ''
        }${
          tariff.bedClass?.nursingRate
            ? `; nursing ₹${tariff.bedClass.nursingRate}/day (service ${tariff.bedClass.nursingCode})`
            : ''
        }
${tariff.payer ? `PAYER / TARIFF: ${tariff.payer}` : 'PAYER / TARIFF: cash (standard rate card)'}

DAILY BENCHMARK for this hospital: ${tariff.benchmark?.text ?? 'no billing history yet — assume a total of ₹10,000–₹15,000 per patient-day for a ward/private medical admission, proportionally more for ICU'}

SERVICE CATALOG — rates already resolved for the admitted bed class.
Copy service_code EXACTLY. Anything not here has no catalog rate.
service_code | name | type | ₹ rate | unit
${catalog
          .map((c) => `${c.code} | ${c.name} | ${c.type} | ${c.rate} | ${c.unit ?? 'each'}`)
          .join('\n')}`
      : '';

    const chartBlock = `
DOCUMENT BEING WRITTEN: ${document?.docTypeLabel ?? document?.docType ?? 'Clinical document'} ${
      document?.documentNumber ?? ''
    }

PATIENT / ADMISSION CONTEXT
- Patient: ${patient?.name ?? 'Unknown'}${patient?.age ? `, ${patient.age} yrs` : ''}${
      patient?.gender ? `, ${patient.gender}` : ''
    }
- Admission no: ${patient?.admissionNumber ?? '—'} · Ward / bed: ${patient?.wardBed ?? 'not allotted'}
- Admitted: ${patient?.admittedOn ?? '—'}${patient?.dischargedOn ? ` · Discharged: ${patient.dischargedOn}` : ''}
- Consultant: ${patient?.doctorName ?? '—'}
- Working diagnosis on chart: ${patient?.diagnosis || 'not recorded'}
- Reason for admission: ${patient?.reasonForAdmission || 'not recorded'}
- Known allergies: ${
      Array.isArray(patient?.allergies) && patient.allergies.length ? patient.allergies.join(', ') : 'none recorded'
    }

SECTIONS IN THIS DOCUMENT — you may only use these ids:
${fields
      .map((f, i) => {
        const current = (f.currentText ?? '').trim();
        const preview = current.length > 300 ? `${current.slice(0, 300)}…` : current;
        return `${i + 1}. id="${f.id}" — "${f.label}"\n   currently: ${preview || '(empty)'}`;
      })
      .join('\n')}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      system: systemPrompt + (isEstimate ? estimateRules : nonEstimateRules),
      output_config: { format: { type: 'json_schema', schema: ASSIST_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `${chartBlock}\n${catalogBlock}\n\nCLINICIAN'S BRIEF: ${instruction}\n\nDraft the document.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    if (!textBlock) throw new Error('No response generated');
    const result = JSON.parse((textBlock as { text: string }).text);

    // --- normalise against what we actually offered --------------------------
    const knownIds = new Set(fields.map((f) => f.id));
    const codes = new Map(catalog.map((c) => [c.code.toLowerCase(), c]));

    const sections = (Array.isArray(result.sections) ? result.sections : [])
      .map((s: Record<string, unknown>) => {
        const text = String(s?.text ?? '').trim();
        if (!text) return null;
        const fieldId = String(s?.field_id ?? '').trim();
        const heading = String(s?.heading ?? '').trim();
        const mode = s?.mode === 'replace' ? 'replace' : 'append';
        if (knownIds.has(fieldId)) return { fieldId, heading: '', text, mode };
        if (heading) return { fieldId: 'new', heading, text, mode: 'replace' };
        return null;
      })
      .filter(Boolean);

    const writtenIds = new Set(sections.map((s: { fieldId: string }) => s.fieldId));
    const removeSections = (Array.isArray(result.remove_sections) ? result.remove_sections : [])
      .map((r: Record<string, unknown>) => ({
        fieldId: String(r?.field_id ?? '').trim(),
        reason: String(r?.reason ?? '').trim(),
      }))
      .filter((r: { fieldId: string }) => knownIds.has(r.fieldId) && !writtenIds.has(r.fieldId));

    const rawEstimate = result.estimate ?? {};
    let estimate = null;
    if (isEstimate && rawEstimate.applicable !== false) {
      const lines = (Array.isArray(rawEstimate.lines) ? rawEstimate.lines : [])
        .map((l: Record<string, unknown>) => {
          const code = String(l?.service_code ?? '').trim();
          const match = code ? codes.get(code.toLowerCase()) : undefined;
          // A code we don't recognise is dropped to an estimated line rather
          // than silently priced at zero.
          const rate = match ? match.rate : Number(l?.unit_rate) || 0;
          const label = String(l?.label ?? match?.name ?? '').trim();
          if (!label || rate <= 0) return null;
          return {
            label,
            serviceCode: match?.code ?? null,
            category: LINE_CATEGORIES.includes(String(l?.category)) ? String(l.category) : 'misc',
            unitRate: rate,
            quantity: Math.max(0, Number(l?.quantity) || 1),
            perDay: Boolean(l?.per_day),
            note: String(l?.note ?? '').trim(),
            estimated: !match,
          };
        })
        .filter(Boolean);

      estimate = {
        stayDays: Math.max(1, Number(rawEstimate.stay_days) || 1),
        lines,
        assumptions: String(rawEstimate.assumptions ?? '').trim(),
        excluded: (Array.isArray(rawEstimate.excluded) ? rawEstimate.excluded : []).map(String),
      };
    }

    return new Response(
      JSON.stringify({
        sections,
        removeSections,
        estimate,
        summary: String(result.summary ?? '').trim(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('ai-document-assist error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
