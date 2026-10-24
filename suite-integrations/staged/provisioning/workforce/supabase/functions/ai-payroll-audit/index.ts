import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-payroll-audit/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { payroll_period_id, organization_id } = await readJson(req);
    if (!payroll_period_id || !organization_id)
      return bad("payroll_period_id & organization_id required", { headers });

    const sb = supabaseAdmin();
    const { data: period, error: perr } = await sb
      .from("payroll_periods")
      .select("*")
      .eq("id", payroll_period_id)
      .single();
    if (perr || !period) return bad(perr?.message ?? "period not found", { headers, status: 404 });

    const { data: users, error: uerr } = await sb
      .from("users")
      .select("id,name,email")
      .eq("organization_id", organization_id);
    if (uerr) return bad(uerr.message, { headers, status: 500 });

    const { data: runs } = await sb
      .from("payroll_runs")
      .select("*")
      .eq("payroll_period_id", payroll_period_id);

    const asOf = new Date(period.year, period.month - 1, 1).toISOString().slice(0, 10);
    const { data: ctcRows } = await sb
      .from("employee_compensation")
      .select("user_id,effective_from,effective_to,ctc_annual")
      .lte("effective_from", asOf)
      .or(`effective_to.is.null,effective_to.gte.${asOf}`);

    const { data: overrides } = await sb
      .from("attendance_monthly_overrides")
      .select("user_id,payload")
      .eq("organization_id", organization_id)
      .eq("month", period.month)
      .eq("year", period.year);

    const prompt = [
      {
        text:
          `Audit payroll readiness for org=${organization_id}, period=${period.month}/${period.year}.\n` +
          `Users: ${users?.length} | Runs: ${runs?.length} | Active CTC rows: ${ctcRows?.length} | Overrides: ${overrides?.length}`,
      },
      {
        text:
          `Find issues:\n- users without active CTC\n- negative/zero net in runs\n- missing overrides when punches absent\n- ESIC eligibility flip (gross <= 21000 vs > 21000, if detectable)\nFormat JSON {issues:[{user_id?,severity:'info'|'warn'|'error',message,hint}]}`,
      },
    ];
    let parsed: any = { issues: [] };
    try {
      parsed = JSON.parse(await gemini(prompt));
    } catch {
      parsed = { issues: [] };
    }

    return ok(parsed, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-payroll-audit'));