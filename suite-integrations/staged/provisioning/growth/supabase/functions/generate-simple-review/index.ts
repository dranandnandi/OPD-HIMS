import { runtimeFetch, guardEdge } from '../_shared/suite-runtime-guard.ts';
export {};
// supabase/functions/generate-simple-review/index.ts
// Simplified review generation using clinic keywords and last 10 reviews for uniqueness

declare const Deno: any;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  };
}

type Flow = 'ai3' | 'simple1';

const GOOGLE_API_KEY =
  (typeof Deno !== 'undefined' && Deno?.env?.get) ? Deno.env.get('ALLGOOGLE_KEY') : undefined;

const FIXED_MODEL = 'gemini-2.5-flash';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu'
};

// ---------- JSON helpers ----------
function safeParseJsonMessages(text: string): string[] | null {
  try {
    const cleaned = String(text).trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as string[];
    if (parsed && Array.isArray((parsed as any).messages)) return (parsed as any).messages as string[];
  } catch {}
  return null;
}

// ---------- Gemini call ----------
async function callGeminiJSON(
  userParts: { text: string }[],
  systemText?: string
): Promise<{ text: string }> {
  if (!GOOGLE_API_KEY) throw new Error('Missing ALLGOOGLE_KEY secret');

  // Randomized parameters for variety
  const temperature = 0.8 + Math.random() * 0.4; // 0.8-1.2
  const topK = 35 + Math.floor(Math.random() * 25); // 35-60
  const topP = 0.88 + Math.random() * 0.07; // 0.88-0.95

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(FIXED_MODEL)}:generateContent?key=${GOOGLE_API_KEY}`;
  const body: any = {
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature,
      topK,
      topP
    }
  };
  if (systemText) {
    body.systemInstruction = { role: 'system', parts: [{ text: systemText }] };
  }

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

  return { text: String(text).trim() };
}

// ---------- Build prompts ----------
function buildSystemInstruction(langCode: string): string {
  const targetName = LANGUAGE_NAMES[langCode] || 'English';
  return `You are an expert Google review generator. Write authentic, varied reviews in ${targetName}. 
Keep technical medical terms in English (Latin script). 
Use natural, conversational language like real patients write.
Your responses must be creative and strictly avoid repeating any phrases, sentences, or concepts that have already been generated in previous reviews.
Each review must be unique with different sentence structures, openings, and word choices.
Output only valid JSON: {"messages": string[]}`;
}

function buildBusinessContextLines(context: any, keywords: string[]): string {
  const lines: string[] = [];
  if (context?.businessType) lines.push(`Business type: ${context.businessType}`);
  if (context?.customerLabel) lines.push(`Customer label: ${context.customerLabel}`);
  if (context?.appointmentLabel) lines.push(`Interaction type: ${context.appointmentLabel}`);
  if (context?.locationLabel) lines.push(`Service mode/location: ${context.locationLabel}`);
  if (keywords.length > 0) lines.push(`Relevant keywords/services: ${keywords.join(', ')}`);
  if (context?.serviceKeywords) lines.push(`Additional keywords/services: ${context.serviceKeywords}`);
  if (context?.promptNotes) lines.push(`Writing guidance: ${context.promptNotes}`);
  return lines.length > 0 ? lines.join('\n') : '';
}

function buildPrompt(input: any): string {
  const langCode = (input.language || 'en').toLowerCase();
  const langName = LANGUAGE_NAMES[langCode] || 'English';
  const flow = input.flow || 'ai3';
  
  const p = input.context || {};
  const patientName = p.patientName || '';
  const clinicName = p.clinicName || '';
  const clinicAddress = p.clinicAddress || '';
  const date = p.date || '';
  const gmbLink = p.gmbLink || '';
  const treatment = p.treatment || '';
  const notes = p.notes || '';
  
  // Parse clinic keywords from JSON string
  let clinicKeywords: string[] = [];
  if (p.clinicKeywords) {
    try {
      clinicKeywords = typeof p.clinicKeywords === 'string' 
        ? JSON.parse(p.clinicKeywords) 
        : p.clinicKeywords;
    } catch {
      clinicKeywords = [];
    }
  }
  const modularContextBlock = buildBusinessContextLines(p.businessContext, clinicKeywords);
  
  // Last 10 reviews for uniqueness check
  const lastReviews = Array.isArray(input.lastReviews) ? input.lastReviews : [];
  
  const uniqueSeed = Date.now();

  if (flow === 'simple1') {
    return `Generate ONE thank you message in ${langName} for WhatsApp.

Patient: ${patientName}
Clinic: ${clinicName}
Address: ${clinicAddress}
Date: ${date}
Treatment: ${treatment}
${notes ? `Notes: ${notes}` : ''}
${clinicKeywords.length > 0 ? `Available services/keywords: ${clinicKeywords.join(', ')}` : ''}
${modularContextBlock ? `\nBusiness-specific writing context:\n${modularContextBlock}\nUse these labels and service modes when wording the message. Avoid doctor/clinic wording if the context says lab, home visit, phone call, video conference, or agency.` : ''}

EXACT FORMAT required:
Hello ${patientName},

We hope you had a satisfying experience with the services at ${clinicName}. Your feedback is highly valuable to us.

Your visit details:
📅 Date: ${date}
🏥 Name of Center: ${clinicName}
📍 Location: ${clinicAddress}

Please post your review to ${gmbLink}

Best regards,
Team ${clinicName}

Rules:
- Write in ${langName} but keep medical/technical terms in English
- Use conversational tone
- Personalize based on treatment and notes
- Seed: ${uniqueSeed}

Return JSON: {"messages": ["message_here"]}`;
  }

  // AI3 flow
  let avoidanceHints = '';
  if (lastReviews.length > 0) {
    avoidanceHints = `\n\nPREVIOUS REVIEWS TO AVOID COPYING (write something DIFFERENT):
${lastReviews.slice(0, 10).map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}

IMPORTANT: DO NOT repeat phrases, sentence structures, or patterns from above reviews.`;
  }

  return `Generate 3 WhatsApp messages in ${langName} for patient review request.

Patient: ${patientName}
Clinic: ${clinicName}
Address: ${clinicAddress}
Date: ${date}
Treatment: ${treatment}
${notes ? `Notes: ${notes}` : ''}
${clinicKeywords.length > 0 ? `Available services/keywords: ${clinicKeywords.join(', ')}` : ''}
${modularContextBlock ? `\nBusiness-specific writing context:\n${modularContextBlock}\nUse these labels and service modes when wording the messages and sample review.` : ''}
${avoidanceHints}

MESSAGE FORMAT:

messages[0] - Greeting (EXACT format):
Hello ${patientName},

We hope you had a satisfying experience with the services at ${clinicName}. Your feedback is highly valuable to us.

Your visit details:
📅 Date: ${date}
🏥 Name of Center: ${clinicName}
📍 Location: ${clinicAddress}

You will receive a sample review in the next message and which you can change or modify.

Best regards,
Team ${clinicName}

messages[1] - Sample Review (2-3 sentences):
Write as the patient describing their visit. Include:
- Why they came (${treatment || 'their visit'})
${notes ? `- Additional context: ${notes}` : ''}
- Brief appreciation for staff/service

CRITICAL RULES for Review:
- Write in FIRST PERSON as the patient ("I came", "My experience", "I felt")
- Use SIMPLE everyday language, NOT marketing phrases
- AVOID: "great experience", "highly recommend", "excellent service", "top-notch", "outstanding"
- USE: "happy with", "felt comfortable", "went smoothly", "staff was helpful", "no complaints"
- Be SPECIFIC about what happened (mention the actual treatment/test)
- Keep medical terms in English (${clinicKeywords.join(', ')})
- Write in ${langName} for other words
- Make it sound DIFFERENT from the previous reviews shown above
- Seed: ${uniqueSeed}

messages[2] - Review Link:
${gmbLink}

Return JSON: {"messages": ["msg1", "msg2", "msg3"]}`;
}

// ---------- Main handler ----------
Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const lang = (body.language || 'en').toLowerCase();
    const flow: Flow = body.flow || 'ai3';

    const systemInstruction = buildSystemInstruction(lang);
    const userPrompt = buildPrompt(body);

    const { text } = await callGeminiJSON([{ text: userPrompt }], systemInstruction);
    const messages = safeParseJsonMessages(text);

    if (!messages) {
      return new Response(JSON.stringify({
        error: 'parse_failed',
        detail: 'Model did not return valid JSON.',
        raw: text
      }), { status: 422, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // Validate message count
    const expectedCount = flow === 'simple1' ? 1 : 3;
    if (messages.length !== expectedCount) {
      return new Response(JSON.stringify({
        error: 'invalid_message_count',
        detail: `Expected ${expectedCount} messages for flow ${flow}, got ${messages.length}`,
        messages
      }), { status: 422, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    return new Response(JSON.stringify({
      language: lang,
      flow,
      messages,
      model: FIXED_MODEL,
      created_at: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });

  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
}, 'growth', 'generate-simple-review'));
