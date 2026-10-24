import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-compliance-explainer/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const { state, month, year } = await readJson(req);
    if (!state || !month || !year) return bad("state, month, year required", { headers });

    const sb = supabaseAdmin();
    const asOf = new Date(year, month - 1, 1).toISOString().slice(0, 10);

    const { data: rules, error } = await sb
      .from("compliance_rules")
      .select("*")
      .eq("state", state)
      .eq("active", true)
      .lte("effective_from", asOf)
      .or(`effective_to.is.null,effective_to.gte.${asOf}`);
    if (error) return bad(error.message, { headers, status: 500 });

    const prompt = [
      { text: `Explain India payroll PF/ESIC/PT for state=${state} as of ${month}/${year}.` },
      { text: `Rules JSON:\n${JSON.stringify(rules, null, 2)}` },
      { text: `Return JSON {markdown:"..."} with bullet math examples and rounding notes.` },
    ];
    let parsed: any;
    try {
      parsed = JSON.parse(await gemini(prompt));
    } catch (e) {
      parsed = { markdown: String(e) };
    }
    return ok(parsed, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-compliance-explainer'));