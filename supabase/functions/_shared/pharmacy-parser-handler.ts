import { PHARMACY_PROMPT, PHARMACY_SCHEMA, CLAUDE_WIRE_FORMAT, cleanExtraction } from './pharmacy-extraction.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
export async function pharmacyParserHandler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return reply({ error: 'Authentication required' }, 401);
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!baseUrl || !anonKey) return reply({ error: 'Authentication service is not configured.' }, 503);
    const authHeaders = { Authorization: authorization, apikey: anonKey, 'Content-Type': 'application/json' };
    const authResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers: authHeaders, signal: AbortSignal.timeout(15000) });
    if (!authResponse.ok || !(await authResponse.json())?.id) return reply({ error: 'Invalid authentication' }, 401);
    const clinicResponse = await fetch(`${baseUrl}/rest/v1/rpc/user_clinic_ids`, { method: 'POST', headers: authHeaders, body: '{}', signal: AbortSignal.timeout(15000) });
    if (!clinicResponse.ok || !(await clinicResponse.json())?.length) return reply({ error: 'Clinic access required' }, 403);
    const body = await req.json();
    const raw = body.imageBase64 || body.pdfBase64;
    if (typeof raw !== 'string') return reply({ error: 'Invoice page is required' }, 400);
    const data = raw.replace(/^data:[^;]+;base64,/, '');
    if (data.length > 7_000_000) return reply({ error: 'Page is too large; use a smaller image or split the PDF into pages.' }, 413);
    const mime = body.pdfBase64 ? 'application/pdf' : body.mimeType || body.fileType || raw.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime)) return reply({ error: 'Use PDF, JPG, PNG or WebP.' }, 400);
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const googleKey = Deno.env.get('ALLGOOGLE_KEY');
    const provider = ['claude', 'gemini'].includes(body.provider) ? body.provider : (anthropicKey ? 'claude' : 'gemini');
    const maxTokens = Math.min(32768, Math.max(4096, Number(Deno.env.get('PHARMACY_MAX_OUTPUT_TOKENS')) || 16384) * (body.retry === true ? 2 : 1));
    let model: string;
    let text: string;
    let usage: unknown;
    if (provider === 'claude') {
      if (!anthropicKey) return reply({ error: 'ANTHROPIC_API_KEY is not configured.' }, 503);
      model = body.quality === 'accurate' ? Deno.env.get('PHARMACY_CLAUDE_ACCURATE_MODEL') || 'claude-sonnet-5-5' : Deno.env.get('PHARMACY_CLAUDE_MODEL') || 'claude-haiku-5-5';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: PHARMACY_PROMPT + CLAUDE_WIRE_FORMAT,
          output_config: { format: { type: 'json_schema', schema: PHARMACY_SCHEMA }, ...(/5-5/.test(model) ? { effort: body.quality === 'accurate' ? 'medium' : 'low' } : {}) },
          messages: [{ role: 'user', content: [
            { type: mime === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mime, data } },
            { type: 'text', text: 'Extract this invoice page completely using the specified JSON shape.' }
          ] }] })
      });
      const result = await response.json();
      if (!response.ok) return reply({ error: result.error?.message || 'Claude request failed' }, response.status === 429 ? 429 : 502);
      if (result.stop_reason !== 'end_turn') return reply({ error: `Incomplete Claude response (${result.stop_reason}). Retry with higher accuracy or a smaller page section.` }, 422);
      text = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      usage = result.usage;
    } else {
      if (!googleKey) return reply({ error: 'ALLGOOGLE_KEY is not configured.' }, 503);
      model = Deno.env.get('PHARMACY_GEMINI_MODEL') || 'gemini-2.5-flash';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': googleKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: PHARMACY_PROMPT }, { inline_data: { mime_type: mime, data } }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, ...(model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } })
      });
      const result = await response.json();
      if (!response.ok) return reply({ error: result.error?.message || 'Gemini request failed' }, response.status === 429 ? 429 : 502);
      if (result.candidates?.[0]?.finishReason !== 'STOP') return reply({ error: `Incomplete Gemini response (${result.candidates?.[0]?.finishReason || 'no candidate'}). Retry this page.` }, 422);
      text = result.candidates[0].content.parts.filter((p: any) => !p.thought && p.text).map((p: any) => p.text).join('');
      usage = result.usageMetadata;
    }
    const extractedData = cleanExtraction(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
    return reply({ success: true, extractedData, model, usage, fileName: body.fileName });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Invoice extraction failed' }, 422);
  }
}
