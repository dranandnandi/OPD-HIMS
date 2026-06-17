import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODEL = 'gemini-2.5-flash';

const languageNames: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  gu: 'Gujarati',
  mr: 'Marathi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  ur: 'Urdu',
};

const stageLabel: Record<string, string> = {
  pre_visit: 'before the appointment',
  waiting: 'while the patient is waiting after arrival',
  post_visit: 'after the visit is completed',
};

interface GeneratedSequenceTemplate {
  messageTemplate: string;
  delayMinutes: number;
  sequenceOrder: number;
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function callGemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('ALLGOOGLE_KEY');
  if (!apiKey) throw new Error('Google API key not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      }),
    },
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Gemini error ${response.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response generated from Gemini');
  return String(text).trim();
}

function buildPrompt(params: Record<string, unknown>) {
  const language = languageNames[String(params.language || 'en')] || 'English';
  const sequenceStage = String(params.sequenceStage || 'waiting');
  const timingContext = stageLabel[sequenceStage] || stageLabel.waiting;
  const numMessages = Math.min(Math.max(Number(params.numMessages || 3), 1), 8);

  return `Create ${numMessages} WhatsApp sequence messages for a healthcare clinic in ${language}.

Theme/condition: ${params.theme || params.conditionType || 'General'}
Sequence stage: ${sequenceStage} (${timingContext})
Profile type: ${params.profileType || 'General'}
Clinic: ${params.clinicName || 'Clinic'}
Additional details: ${params.details || 'General patient education and helpful reminders'}

LANGUAGE RULES:
- If ${language} is not English, write patient-facing sentences in natural ${language}.
- Always keep clinical/medical terms in English where possible, for example: diabetes, blood pressure, physiotherapy, exercise, mobility, swelling, pain, fever, follow-up, appointment, prescription.
- Always keep placeholders exactly as written in English.
- Always keep clinic name, doctor name, dates, times, phone numbers, and URLs in English.
- Tone must always be kind, reassuring, respectful, and simple.
- Avoid fear-based language. Do not diagnose. Do not promise cure.
- Use Indian clinic context and practical patient instructions.

PLACEHOLDERS:
Use these exact placeholders where useful. Do not invent other placeholder formats.
- {{patientName}}
- {{appointmentDate}}
- {{appointmentTime}}
- {{appointmentDateTime}}
- {{doctorName}}
- {{clinicName}}
- {{clinicPhone}}

TIMING RULES:
- Return delayMinutes as a number.
- For pre_visit: delayMinutes means minutes BEFORE appointment. Use values like 2880, 1440, 180, 60.
- For waiting: delayMinutes means minutes AFTER arrival. Use values like 1, 10, 20, 30.
- For post_visit: delayMinutes means minutes AFTER completion. Use values like 60, 1440, 4320, 10080.
- Keep sequenceOrder starting at 1.

MESSAGE REQUIREMENTS:
- WhatsApp-friendly, short, useful, and professional.
- Keep each message under 120 words.
- Use simple line breaks.
- Include educational value related to the theme.
- For waiting messages, avoid making promises about exact doctor availability.
- For pre/post visit messages, include appointment placeholders when relevant.
- Every message must end with a kind closing using available placeholders, for example:
  "Kind regards,\\n{{clinicName}}\\n{{clinicPhone}}"
- If phone is not needed in the sentence body, still include {{clinicPhone}} in the closing.

Return ONLY a valid JSON array:
[
  {
    "messageTemplate": "Hello {{patientName}},\\n\\nmessage here...",
    "delayMinutes": 1440,
    "sequenceOrder": 1
  }
]`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const raw = await callGemini(buildPrompt(body));
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      return json({ error: 'invalid_response', detail: 'Response is not an array' }, 422);
    }

    const templates: GeneratedSequenceTemplate[] = parsed.map((item, index) => {
      if (!item?.messageTemplate || item?.delayMinutes === undefined) {
        throw new Error(`Invalid template at index ${index}`);
      }
      return {
        messageTemplate: String(item.messageTemplate),
        delayMinutes: Math.max(1, Number.parseInt(String(item.delayMinutes), 10) || 1),
        sequenceOrder: Number.parseInt(String(item.sequenceOrder), 10) || index + 1,
      };
    });

    templates.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    return json({
      success: true,
      templates,
      model: MODEL,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('generate-waiting-sequence-templates failed', error);
    return json({
      error: 'generation_failed',
      detail: error instanceof Error ? error.message : 'Failed to generate sequence templates',
    }, 500);
  }
});
