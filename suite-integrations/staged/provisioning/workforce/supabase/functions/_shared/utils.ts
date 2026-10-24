import { withSuiteClient, runtimeFetch } from './suite-runtime-guard.ts';
// supabase/functions/_shared/utils.ts
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const createClient=withSuiteClient(dsBase_createClient);


export function supabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceKey, {
    global: { headers: { "x-application-name": "payroll-edge" } },
  });
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return await req.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function ok<T>(data: T, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: true, data }), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

export function bad(message: string, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: init.status ?? 400,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

export function cors(req: Request) {
  return {
    "access-control-allow-origin": req.headers.get("origin") ?? "*",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

/** Gemini 2.5 Flash client (uses ALLGOOGLE_KEY) */
export async function gemini(parts: any[], safetySettings: any[] = []) {
  const key = Deno.env.get("ALLGOOGLE_KEY") ?? "";
  if (!key) throw new Error("Missing ALLGOOGLE_KEY");
  const model = "gemini-2.5-flash";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent?key=" +
    key;

  const body: any = { contents: [{ role: "user", parts }] };
  if (Array.isArray(safetySettings) && safetySettings.length > 0) {
    body.safetySettings = safetySettings;
  }
  const res = await runtimeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  return text;
}

export function extractJsonObject(text: string) {
  const fenced =
    text.match(/```json\s*([\s\S]*?)\s*```/i) ||
    text.match(/```\s*([\s\S]*?)\s*```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  return JSON.parse(raw);
}

export async function anthropic(
  system: string,
  userText: string,
  model = "claude-haiku-4-5",
) {
  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");

  const res = await runtimeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.content?.map((c: any) => c?.text ?? "").join("") ?? "";
}

export async function llmJson(opts: {
  provider: "gemini" | "haiku";
  parts?: any[];
  system?: string;
  userText?: string;
}) {
  if (opts.provider === "haiku") {
    const text = await anthropic(opts.system ?? "", opts.userText ?? "");
    return extractJsonObject(text);
  }

  const text = await gemini(opts.parts ?? []);
  return extractJsonObject(text);
}
