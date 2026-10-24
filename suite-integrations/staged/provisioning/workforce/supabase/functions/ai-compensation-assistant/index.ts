import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// -------------------------- PROMPT: simple & strict -------------------------
const SYSTEM_PROMPT = `You are an Indian payroll assistant.

OUTPUT RULES (STRICT):
- Respond with VALID JSON only (no markdown).
- Use ONLY the component codes from "AVAILABLE COMPONENTS".
- All component amounts MUST be ANNUAL (12 months total), numbers only.
- Earnings must be >= 0; Deductions must be <= 0.
- ctc_annual = sum of all positive (earnings) amounts.
- If user asks for an in-hand/take-home per month, choose a reasonable split across available earnings and deductions to meet that net. Do not explain math in the JSON, just return the numbers.

RESPONSE SCHEMA:
{
  "compensation": {
    "ctc_annual": number,
    "pay_schedule": "monthly",
    "currency": "INR",
    "components": [ {"component_code": string, "amount": number}, ... ],
    "notes": string
  },
  "explanation": string,
  "conversation_complete": boolean,
  "next_questions": string[]
}`;

// ------------------------------ utils --------------------------------------
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const parseNetTarget = (text: string): number | null => {
  const t = text.toLowerCase();
  const m = t.match(/(\d[\d,]*)(k)?\s*(in\s*-?hand|take\s*-?home|net(\s*pay)?)/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= 1000; // supports "15k"
  return n;
};

type CompLine = { component_code: string; amount: number };

function buildMaps(available: { code: string }[]) {
  const allowed = new Set<string>();
  const map: Record<string, string> = {};
  for (const a of available) {
    allowed.add(a.code);
    map[a.code] = a.code;
    map[a.code.toUpperCase()] = a.code;
    map[a.code.toLowerCase()] = a.code;
  }
  // common aliases → prefer existing codes only
  const prefer = (alias: string, target: string) => { if (allowed.has(target)) map[alias] = target; };
  prefer("PF", "PF_EE");
  prefer("ESI", "esic_employee");
  prefer("SPEC", "special");
  prefer("MED", "MED"); // if MED exists it will map; else dropped
  return { allowed, map };
}

const isDeduction = (code: string) => /^(PF(_EE)?|esic_employee|PT|TDS)$/i.test(code);

function normalize(lines: CompLine[], available: { code: string }[]) {
  const { allowed, map } = buildMaps(available);
  const acc = new Map<string, number>();
  const dropped: { raw_code: string; amount: number }[] = [];

  for (const l of lines || []) {
    const raw = String(l.component_code || "");
    const code = map[raw] || map[raw.toUpperCase()] || map[raw.toLowerCase()] || (allowed.has(raw) ? raw : null);
    if (!code || !allowed.has(code)) { dropped.push({ raw_code: raw, amount: Number(l.amount)||0 }); continue; }

    let amt = Number(l.amount) || 0;
    // enforce signs simply
    if (isDeduction(code) && amt > 0) amt = -amt;
    if (!isDeduction(code) && amt < 0) amt = -amt;

    acc.set(code, (acc.get(code) || 0) + amt);
  }

  const out: CompLine[] = Array.from(acc.entries()).map(([component_code, amount]) => ({ component_code, amount: Math.round(amount) }));
  return { lines: out, dropped, allowed };
}

const a2m = (n: number) => n / 12;
const netMonthly = (lines: CompLine[]) => {
  let earnA = 0, dedA = 0;
  for (const l of lines) (l.amount >= 0 ? earnA += l.amount : dedA += l.amount);
  return a2m(earnA - Math.abs(dedA));
};

function adjustToTarget(lines: CompLine[], targetNetMonthly: number, allowed: Set<string>) {
  const adjustOrder = ["special", "HRA", "BASIC", "CONV"]; // pick first present/allowed earning
  let adjCode: string | null = null;
  for (const c of adjustOrder) if (allowed.has(c)) { adjCode = c; break; }
  if (!adjCode) {
    // fallback: any earning-looking code
    for (const l of lines) if (!isDeduction(l.component_code)) { adjCode = l.component_code; break; }
  }
  if (!adjCode) return;

  const current = Math.round(netMonthly(lines));
  const deltaM = targetNetMonthly - current;
  if (Math.abs(deltaM) <= 50) return; // simple tolerance
  const deltaA = Math.round(deltaM * 12);

  const i = lines.findIndex(l => l.component_code === adjCode);
  if (i >= 0) lines[i].amount = Math.max(0, Math.round(lines[i].amount + deltaA));
  else if (deltaA > 0) lines.push({ component_code: adjCode, amount: deltaA });
}

// ------------------------------- server ------------------------------------
serve(guardEdge(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { user_input = "", current_compensation, conversation_history, available_components = [] } = body || {};

    const target = parseNetTarget(String(user_input));

    const availableList = (available_components as any[]).map(c => `${c.code}: ${c.name} (${c.type})`).join("\n");

    let ctx = "";
    if (current_compensation) ctx += `\nCURRENT COMPENSATION:\n${JSON.stringify(current_compensation, null, 2)}`;
    if (available_components?.length) ctx += `\nAVAILABLE COMPONENTS:\n${availableList}`;
    if (conversation_history?.length) ctx += `\nCONVERSATION HISTORY:\n${conversation_history.map((m: any) => `${m.role}: ${m.content}`).join("\n")}`;

    const userBlock = target ? `USER INPUT: ${user_input}\nTARGET NET (monthly): ${target}` : `USER INPUT: ${user_input}`;
    const prompt = `${SYSTEM_PROMPT}\n${ctx}\n\n${userBlock}\n\nReturn JSON now:`;

    const key = Deno.env.get("ALLGOOGLE_KEY");
    if (!key) return jsonResponse({ error: "Missing ALLGOOGLE_KEY" }, 500);

    const resp = await runtimeFetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1400 } }),
    });

    if (!resp.ok) return jsonResponse({ error: `Gemini API error ${resp.status}` }, 500);

    const data = await resp.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const fenced = text.match(/```json\n?([\s\S]*?)\n?```/i) || text.match(/```\n?([\s\S]*?)\n?```/i);
    const raw = (fenced ? fenced[1] : text).trim();

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return jsonResponse({ error: "Invalid AI response" }, 500); }
    if (!parsed?.compensation || !Array.isArray(parsed?.compensation?.components)) return jsonResponse({ error: "Bad structure" }, 500);

    // normalize simple
    const norm = normalize(parsed.compensation.components, available_components);
    let lines = norm.lines;

    // simple adjust for target net (no auto-adding PF/ESI/PT/TDS)
    if (target) adjustToTarget(lines, target, norm.allowed);

    // recompute CTC from earnings
    const ctcAnnual = lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const netM = Math.round(netMonthly(lines));

    return jsonResponse({
      compensation: {
        ctc_annual: Math.round(ctcAnnual),
        pay_schedule: "monthly",
        currency: "INR",
        components: lines,
        notes: parsed?.compensation?.notes || (target ? `Aimed for net ≈ ₹${netM}/month.` : "Annual amounts returned."),
      },
      explanation: parsed?.explanation || "Simplified normalization applied.",
      conversation_complete: Boolean(parsed?.conversation_complete),
      next_questions: parsed?.next_questions || ["Adjust any component?", "Lock this structure?"],
      _debug: { dropped: norm.dropped }
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
}, 'workforce', 'ai-compensation-assistant'));
