import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
export {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;
// supabase/functions/generate-review/index.ts
// Generates a short human-style patient review via Gemini.
// Deploy with: supabase functions deploy generate-review --no-verify-jwt
// Preflight-safe (CORS) and POST only.
//
// Secret required:
//   supabase secrets set ALLGOOGLE_KEY="YOUR_GOOGLE_API_KEY"
const MODEL = 'gemini-2.0-flash-lite'; // <-- use a valid model id
const GOOGLE_API_KEY = Deno.env.get('ALLGOOGLE_KEY');
const QUALITIES = [
  'friendly staff',
  'clean environment',
  'clear communication',
  'professional care',
  'minimal waiting time',
  'comfortable experience',
  'organized process',
  'supportive team',
  'thorough explanation',
  'efficient service',
  'modern facilities',
  'hygienic clinic'
];
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  };
}
function pickQualities(n = 2) {
  return [
    ...QUALITIES
  ].sort(()=>Math.random() - 0.5).slice(0, n);
}
function sanitize(str: string) {
  return str.replace(/[`"'<>]/g, '').trim();
}

function parseKeywords(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function buildBusinessContextLines(context: any, keywords: string[]): string {
  const lines: string[] = [];
  if (context?.businessType) lines.push(`Business type: ${sanitize(String(context.businessType))}`);
  if (context?.customerLabel) lines.push(`Customer label: ${sanitize(String(context.customerLabel))}`);
  if (context?.appointmentLabel) lines.push(`Interaction type: ${sanitize(String(context.appointmentLabel))}`);
  if (context?.locationLabel) lines.push(`Service mode/location: ${sanitize(String(context.locationLabel))}`);
  if (keywords.length) lines.push(`Relevant service keywords: ${keywords.map(sanitize).join(', ')}`);
  if (context?.serviceKeywords) lines.push(`Additional service keywords: ${sanitize(String(context.serviceKeywords))}`);
  if (context?.promptNotes) lines.push(`Writing guidance: ${sanitize(String(context.promptNotes))}`);
  return lines.join('\n');
}
Deno.serve(guardEdge(async (req: Request)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      }
    });
  }
  if (!GOOGLE_API_KEY) {
    return new Response(JSON.stringify({
      error: 'Server misconfiguration: missing ALLGOOGLE_KEY'
    }), {
      status: 500,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      }
    });
  }
  let body;
  try {
    body = await req.json();
  } catch  {
    return new Response(JSON.stringify({
      error: 'Invalid JSON body'
    }), {
      status: 400,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      }
    });
  }
  const errors = [];
  if (!body.clinicName) errors.push('clinicName required');
  if (!body.treatment) errors.push('treatment required');
  if (!body.date) errors.push('date required');
  if (errors.length) {
    return new Response(JSON.stringify({
      error: errors.join(', ')
    }), {
      status: 400,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      }
    });
  }
  const clinicName = sanitize(body.clinicName);
  const treatment = sanitize(body.treatment);
  const visitDate = sanitize(body.date);
  const tone = body.tone || 'friendly';
  const language = (body.language || 'en').toLowerCase();
  const maxWords = Math.min(Math.max(body.maxWords || 55, 35), 80);
  const seedHint = body.seedPatientHint ? sanitize(body.seedPatientHint) : '';
  const qualities = pickQualities();
  const keywordList = parseKeywords(body.clinicKeywords);
  const businessContextBlock = buildBusinessContextLines(body.businessContext, keywordList);
  const prompt = `
You are generating a brief, authentic patient review.

REQUIRED:
- First-person (I / my).
- Mention clinic ONCE: ${clinicName}.
- Mention service: ${treatment}.
- Reference timing (e.g. “today”, “recently”, or date ${visitDate}).
- Naturally weave in: ${qualities.join(', ')}.
${seedHint ? `- Extra context: ${seedHint}` : ''}
${businessContextBlock ? `\nBUSINESS CONTEXT:\n${businessContextBlock}\n- Use this context to avoid wrong wording. Use configured labels such as client, home visit, phone call, video consultation, or agency when provided.` : ''}

STYLE:
- Tone: ${tone}.
- Language: ${language === 'en' ? 'English' : 'Fully in ' + language}.
- Length: ${maxWords - 15} to ${maxWords} words (HARD CAP).
- 2–4 sentences; vary length.
- Positive & believable;
- NO lists, bullets, emojis, hashtags.

FORBIDDEN:
- Doctor or staff personal names.
- Quotation marks surrounding entire review.
- Overhyped marketing buzzwords ("world-class", "life-changing").
- Repeating clinic name.
- Private health specifics beyond treatment mention.
- Calls to action / contact info / URLs / phone numbers.

OUTPUT:
Return ONLY the plain review text (no JSON, no quotes, no backticks).
`;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.85,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 256
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE'
        }
      ]
    };
    const aiResp = await runtimeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('Gemini API error:', aiResp.status, errTxt);
      return new Response(JSON.stringify({
        error: 'Gemini API error',
        status: aiResp.status,
        details: errTxt
      }), {
        status: 502,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/json'
        }
      });
    }
  const json = await aiResp.json();
  const raw = json?.candidates?.[0]?.content?.parts?.map((p: any)=>p.text).join(' ').trim() || json?.candidates?.[0]?.output_text || '';
    if (!raw) {
      return new Response(JSON.stringify({
        error: 'Empty model response'
      }), {
        status: 502,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/json'
        }
      });
    }
    let review = raw.replace(/^['"`]+/, '').replace(/['"`]+$/, '').replace(/\s+/g, ' ').trim();
    const words = review.split(/\s+/);
    if (words.length > maxWords) {
      review = words.slice(0, maxWords).join(' ').replace(/[.,;:!?]*$/, '') + '.';
    }
    return new Response(JSON.stringify({
      reviewText: review,
      meta: {
        usedModel: MODEL,
        qualities,
        wordCount: review.split(/\s+/).length,
        language
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('Internal error:', err);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      }
    });
  }
}, 'growth', 'generate-review'));
