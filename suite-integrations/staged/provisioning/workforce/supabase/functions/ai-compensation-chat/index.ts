import { withSuiteClient, runtimeFetch, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2";
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractFirstBalancedJson(input: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (start === -1) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
      if (start !== -1 && depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

type HaikuCallResult = { text: string; stopReason?: string };

function computeAnnualCtcFromComponents(
  components: Array<{ component_code: string; amount: number }> = [],
): number {
  return Math.round(
    components.reduce((sum, line) => {
      const amt = Number(line?.amount) || 0;
      return amt > 0 ? sum + amt : sum;
    }, 0),
  );
}

async function callHaiku(system: string, userText: string, maxTokens = 1600): Promise<HaikuCallResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");

  const resp = await runtimeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      temperature: 0.1,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  const text = data?.content?.map((c: any) => c?.text ?? "").join("") ?? "";
  return { text, stopReason: data?.stop_reason };
}

serve(guardEdge(async (req) => {
  const reqId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { user_input = "", current_compensation, conversation_history = [] } = body || {};
    console.log(`[ai-comp-chat][${reqId}] request received`, {
      user_input_len: String(user_input || "").length,
      has_current_compensation: !!current_compensation,
      history_len: Array.isArray(conversation_history) ? conversation_history.length : 0,
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: components, error: compError } = await supabase
      .from("pay_components")
      .select("code, name, type")
      .eq("active", true);

    if (compError) {
      console.error(`[ai-comp-chat][${reqId}] error fetching components`, compError);
      return jsonResponse({ error: "Failed to fetch pay components" }, 500);
    }

    const earnings =
      components?.filter((c) => c.type === "earning").map((c) => `${c.code} (${c.name})`).join(", ") ||
      "BASIC, HRA, CONV, SPEC";
    const deductions =
      components?.filter((c) => c.type === "deduction").map((c) => `${c.code} (${c.name})`).join(", ") ||
      "PF_EE, PT, TDS";
    const employerCosts =
      components?.filter((c) => c.type === "employer_cost").map((c) => `${c.code} (${c.name})`).join(", ") ||
      "PF_ER, ESI_ER";

    const systemPrompt = `You are an Indian payroll assistant.
Return VALID JSON only. No markdown fences.

Output schema:
{
  "compensation": {
    "ctc_annual": number,
    "pay_schedule": "monthly" | "weekly" | "biweekly",
    "currency": "INR",
    "components": [{"component_code": string, "amount": number}],
    "notes": string
  },
  "explanation": string,
  "conversation_complete": boolean,
  "next_questions": string[]
}

Rules:
- Use ONLY component codes from provided lists.
- Earnings must be positive.
- Deductions must be negative.
- Employer costs must be positive.
- Keep all amounts annual.`;

    const userPrompt = `AVAILABLE CODES
EARNINGS: ${earnings}
DEDUCTIONS: ${deductions}
EMPLOYER COSTS: ${employerCosts}

CURRENT_COMP: ${JSON.stringify(current_compensation || {}, null, 2)}

HISTORY:
${conversation_history.map((m: any) => `${m.role}: ${m.content}`).join("\n")}

USER: ${user_input}

Return only one valid JSON object.`;

    const first = await callHaiku(systemPrompt, userPrompt, 1700);
    let text = first.text.trim();
    console.log(`[ai-comp-chat][${reqId}] model response #1`, {
      text_len: text.length,
      stop_reason: first.stopReason,
      text_head: text.slice(0, 180),
    });

    let parsed: any;
    try {
      parsed = JSON.parse(text);
      console.log(`[ai-comp-chat][${reqId}] parse success #1 direct`);
    } catch {
      console.log(`[ai-comp-chat][${reqId}] parse failed #1 direct`);
      try {
        const candidate = extractFirstBalancedJson(text);
        if (!candidate) throw new Error("No balanced JSON found in response #1");
        parsed = JSON.parse(candidate);
        console.log(`[ai-comp-chat][${reqId}] parse success #1 balanced`, {
          candidate_len: candidate.length,
        });
      } catch {
        console.log(`[ai-comp-chat][${reqId}] parse failed #1 balanced, retrying`);
        const repairUserPrompt = `${userPrompt}

IMPORTANT: Previous output was invalid or truncated.
Return ONLY one complete JSON object matching the schema exactly.`;

        const second = await callHaiku(systemPrompt, repairUserPrompt, 1700);
        text = second.text.trim();
        console.log(`[ai-comp-chat][${reqId}] model response #2`, {
          text_len: text.length,
          stop_reason: second.stopReason,
          text_head: text.slice(0, 180),
        });

        try {
          parsed = JSON.parse(text);
          console.log(`[ai-comp-chat][${reqId}] parse success #2 direct`);
        } catch {
          const candidate2 = extractFirstBalancedJson(text);
          if (!candidate2) {
            console.error(`[ai-comp-chat][${reqId}] all parse attempts failed`);
            return jsonResponse(
              {
                error: "Model returned invalid/truncated JSON twice",
                raw_preview: text.slice(0, 220),
              },
              502,
            );
          }
          parsed = JSON.parse(candidate2);
          console.log(`[ai-comp-chat][${reqId}] parse success #2 balanced`, {
            candidate_len: candidate2.length,
          });
        }
      }
    }

    if (!parsed?.compensation) {
      console.error(`[ai-comp-chat][${reqId}] parsed JSON missing compensation`);
      return jsonResponse(
        {
          error: "Model JSON missing compensation field",
          parsed_preview: JSON.stringify(parsed).slice(0, 220),
        },
        502,
      );
    }

    const normalizedCompensation = {
      ...parsed.compensation,
      ctc_annual:
        Number(parsed?.compensation?.ctc_annual) > 0
          ? Math.round(Number(parsed.compensation.ctc_annual))
          : computeAnnualCtcFromComponents(parsed?.compensation?.components || []),
    };

    console.log(`[ai-comp-chat][${reqId}] returning response`, {
      has_compensation: !!parsed?.compensation,
      component_count: Array.isArray(parsed?.compensation?.components) ? parsed.compensation.components.length : 0,
      conversation_complete: !!parsed?.conversation_complete,
      ctc_annual: normalizedCompensation.ctc_annual,
    });
    return jsonResponse({ ...parsed, compensation: normalizedCompensation });
  } catch (e: any) {
    console.error(`[ai-comp-chat][${reqId}] unhandled error`, e?.message || e);
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
}, 'workforce', 'ai-compensation-chat'));
