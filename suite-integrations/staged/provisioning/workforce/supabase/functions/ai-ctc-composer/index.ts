import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-ctc-composer/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { organization_id, ctc_annual, role, payroll_state, policy_flags } =
      await readJson(req);
    if (!organization_id || !ctc_annual)
      return bad("organization_id & ctc_annual required", { headers });

    const sb = supabaseAdmin();
    const { data: components, error: compErr } = await sb
      .from("pay_components")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (compErr) return bad(compErr.message, { headers, status: 500 });

    const prompt = [
      {
        text:
          `Design an India payroll CTC split. Total CTC annual: ₹${ctc_annual}. Role: ${role ?? "unspecified"}. ` +
          `State: ${payroll_state ?? "IN"}. Policy flags: ${JSON.stringify(policy_flags ?? {})}`,
      },
      {
        text:
          `Available components (code,type,method,default_value,flags):\n` +
          components
            .map(
              (c: any) =>
                `${c.code}|${c.type}|${c.calc_method}|${c.calc_value}|pf=${c.pf_wage_participates},esic=${c.esic_wage_participates}`,
            )
            .join("\n"),
      },
      {
        text:
          `Output JSON {compensation_payload:[{component_code,override_calc_method?,override_calc_value?}]}. ` +
          `Sum monthly earnings should ≈ CTC/12. Do not add statutory deductions as earnings.`,
      },
      { text: `Heuristics: Basic 35–50% of gross; HRA ≈ 50% of Basic; remaining to Special.` },
    ];

    const text = await gemini(prompt);
    let payload;
    try {
      const parsed = JSON.parse(text);
      payload = parsed.compensation_payload ?? parsed;
    } catch {
      // fallback simple split
      const monthly = Number(ctc_annual) / 12;
      const basic = Math.round(monthly * 0.4);
      const hra = Math.round(basic * 0.5);
      const special = Math.max(0, Math.round(monthly - basic - hra));
      payload = [
        {
          component_code: "basic",
          override_calc_method: "fixed",
          override_calc_value: basic,
        },
        { component_code: "hra", override_calc_method: "fixed", override_calc_value: hra },
        {
          component_code: "special",
          override_calc_method: "fixed",
          override_calc_value: special,
        },
      ];
    }

    return ok({ compensation_payload: payload }, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-ctc-composer'));