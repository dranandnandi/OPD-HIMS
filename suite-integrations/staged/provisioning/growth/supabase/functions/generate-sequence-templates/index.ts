import { runtimeFetch, guardEdge } from '../_shared/suite-runtime-guard.ts';
export {};
// supabase/functions/generate-sequence-templates/index.ts
// Generate AI sequence templates for WhatsApp messaging

declare const Deno: any;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  };
}

const GOOGLE_API_KEY =
  (typeof Deno !== 'undefined' && Deno?.env?.get) ? Deno.env.get('ALLGOOGLE_KEY') : undefined;

const FIXED_MODEL = 'gemini-2.5-flash';

interface SequenceTemplateAI {
  messageTemplate: string;
  sequenceDays: number;
  sequenceOrder: number;
}

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
  ur: 'Urdu'
};

async function callGemini(prompt: string): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error('Missing ALLGOOGLE_KEY secret');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(FIXED_MODEL)}:generateContent?key=${GOOGLE_API_KEY}`;
  
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.9,
      topK: 40,
      topP: 0.95
    }
  };

  const resp = await runtimeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${detail}`);
  }

  const json = await resp.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.[0]?.text ??
    json?.candidates?.[0]?.content?.parts?.[0]?.inline_data?.data ?? '';
  
  if (!text || String(text).trim().length === 0) {
    throw new Error('Empty response from Gemini');
  }

  return String(text).trim();
}

function buildPrompt(params: any): string {
  const languageName = languageNames[params.language] || 'English';
  const businessContext = params.businessContext || {};
  const contextLines = [
    businessContext.businessType ? `Business type: ${businessContext.businessType}` : '',
    businessContext.customerLabel ? `Customer label: ${businessContext.customerLabel}` : '',
    businessContext.appointmentLabel ? `Interaction type: ${businessContext.appointmentLabel}` : '',
    businessContext.locationLabel ? `Service mode/location: ${businessContext.locationLabel}` : '',
    businessContext.serviceKeywords ? `Service keywords: ${businessContext.serviceKeywords}` : '',
    params.clinicKeywords ? `Existing keyword list: ${params.clinicKeywords}` : '',
    businessContext.promptNotes ? `Writing guidance: ${businessContext.promptNotes}` : '',
  ].filter(Boolean).join('\n');
  
  return `Create ${params.numMessages} WhatsApp-friendly sequence messages for ${businessContext.businessType || 'a healthcare clinic'} in ${languageName}.

Theme: ${params.theme}
Details: ${params.details || 'General healthcare'}
Profile Type: ${params.profileType}
Clinic: ${params.clinicName}
${contextLines ? `\nBusiness context:\n${contextLines}\nUse this context to avoid wrong assumptions. For example, say home visit, phone call, video consultation, lab, client, or policyholder when configured instead of generic clinic/doctor wording.` : ''}

STRUCTURE REQUIREMENTS:
1. Each message must follow this structure:
   - Greeting: Start with "Hello {patient_name},"
   - Main Content: Educational/informational content related to the theme
   - Call to Action: Encourage contact or visit
   - Closing: End with clinic name and contact info

2. Use these placeholders (DO NOT replace them):
   - {patient_name} - for patient's name
   - {clinic_name} - for clinic name
   - {clinic_phone} - for clinic phone number

3. WhatsApp-friendly formatting:
   - Use emojis appropriately (📞, 🏥, 📅, ✅, etc.)
   - Keep messages under 300 words
   - Use line breaks for readability
   - Bold important text with **text**

4. Sequence timing:
   - Message 1: 7-15 days after visit
   - Message 2: 25-35 days after visit
   - Message 3: 50-65 days after visit
   - Continue pattern with 20-30 day gaps

5. Content progression:
   - Early messages: General health tips and check-in
   - Middle messages: Specific advice related to theme
   - Later messages: Preventive care and follow-up reminders

RESPONSE FORMAT (JSON):
Return ONLY a valid JSON array with this exact structure:
[
  {
    "messageTemplate": "Hello {patient_name},\\n\\nYour message content here...\\n\\n✅ Contact us at:\\n📞 {clinic_name} | {clinic_phone}",
    "sequenceDays": 15,
    "sequenceOrder": 1
  }
]

IMPORTANT:
- Return ONLY the JSON array, no additional text or markdown
- Ensure proper JSON escaping for line breaks (\\n)
- Make content relevant to ${params.theme} and ${params.profileType}
- Include educational value in each message
- Maintain professional yet friendly tone
- Output must be valid JSON that can be parsed directly`;
}

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const prompt = buildPrompt(body);
    const responseText = await callGemini(prompt);

    // Parse and validate response
    const cleanedResponse = responseText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const templates = JSON.parse(cleanedResponse);

    if (!Array.isArray(templates)) {
      return new Response(JSON.stringify({
        error: 'invalid_response',
        detail: 'Response is not an array'
      }), { status: 422, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // Validate each template
    const validatedTemplates: SequenceTemplateAI[] = templates.map((template: any, index: number) => {
      if (!template.messageTemplate || !template.sequenceDays || !template.sequenceOrder) {
        throw new Error(`Invalid template structure at index ${index}`);
      }
      
      return {
        messageTemplate: template.messageTemplate,
        sequenceDays: parseInt(template.sequenceDays),
        sequenceOrder: parseInt(template.sequenceOrder)
      };
    });

    return new Response(JSON.stringify({
      templates: validatedTemplates,
      model: FIXED_MODEL,
      created_at: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });

  } catch (error) {
    console.error('Error generating sequence templates:', error);
    return new Response(JSON.stringify({
      error: 'generation_failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
}, 'growth', 'generate-sequence-templates'));
