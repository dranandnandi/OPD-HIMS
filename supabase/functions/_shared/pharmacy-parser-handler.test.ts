import { pharmacyParserHandler } from './pharmacy-parser-handler.ts';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const sample = { complete: true, visibleRowCount: 1, invoiceInfo: { invoiceNumber: '177' }, medicines: [{ medicineName: 'ASTHALIN', quantity: 1, unitCostPrice: 9.94, mrp: 13.04, gstRate: 5, discountPercent: 5 }] };

Deno.test('provider requests preserve MIME, select models, increase retry budget and reject truncation', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ANTHROPIC_API_KEY', 'ALLGOOGLE_KEY', 'PHARMACY_MAX_OUTPUT_TOKENS', 'PHARMACY_CLAUDE_MODEL', 'PHARMACY_CLAUDE_ACCURATE_MODEL', 'PHARMACY_GEMINI_MODEL'];
  const originalEnv = keys.map(key => Deno.env.get(key));
  Deno.env.set('SUPABASE_URL', 'https://example.invalid');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-only');
  Deno.env.set('ANTHROPIC_API_KEY', 'test-only');
  Deno.env.set('ALLGOOGLE_KEY', 'test-only');
  keys.slice(4).forEach(key => Deno.env.delete(key));
  let sent: any;
  let providerResponse: any = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(sample) }] };
  let requests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return Response.json({ id: '00000000-0000-0000-0000-000000000001' });
    if (url.includes('/rpc/user_clinic_ids')) return Response.json(['00000000-0000-0000-0000-000000000002']);
    requests++; sent = JSON.parse(String(init?.body));
    return Response.json(providerResponse);
  }) as typeof fetch;
  const request = (body: Record<string, unknown> = {}) => pharmacyParserHandler(new Request('https://example.invalid/parser', {
    method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: 'data:image/png;base64,dGVzdA==', mimeType: 'image/png', ...body })
  }));
  try {
    let response = await request();
    assert(response.status === 200, await response.text());
    assert(sent.model === 'claude-haiku-5-5', 'default uses Haiku');
    assert(sent.max_tokens === 16384, 'per-page output budget');
    assert(sent.messages[0].content[0].source.media_type === 'image/png', 'PNG must not be labelled JPEG');
    assert(sent.output_config.format.type === 'json_schema', 'strict output schema');
    response = await request({ quality: 'accurate', retry: true });
    assert(response.status === 200, await response.text());
    assert(sent.model === 'claude-sonnet-5-5' && sent.max_tokens === 32768, 'accurate retry budget');
    providerResponse = { stop_reason: 'max_tokens', content: [{ type: 'text', text: JSON.stringify(sample) }] };
    response = await request();
    assert(response.status === 422, 'even syntactically valid truncated output must fail');
    providerResponse = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(sample) }] } }] };
    response = await request({ provider: 'gemini' });
    assert(response.status === 422, 'Gemini truncation must fail');
    providerResponse.candidates[0].finishReason = 'STOP';
    response = await request({ provider: 'gemini' });
    assert(response.status === 200, await response.text());
    assert(sent.generationConfig.maxOutputTokens === 16384, 'Gemini gets explicit budget');
    const before = requests;
    response = await pharmacyParserHandler(new Request('https://example.invalid/parser', { method: 'POST', body: '{}' }));
    assert(response.status === 401 && requests === before, 'unauthenticated calls never reach a provider');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => originalEnv[i] == null ? Deno.env.delete(key) : Deno.env.set(key, originalEnv[i]!));
  }
});
