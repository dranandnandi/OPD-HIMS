import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-challan-assist/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

type In = {
  payroll_period_id: string;
  filing_type: "PF_ECR" | "ESIC_RETURN" | "PT" | "TDS24Q" | "CHALLAN_PF" | "CHALLAN_ESIC";
  generated_by?: string;
};

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { payroll_period_id, filing_type, generated_by } = await readJson<In>(req);
    if (!payroll_period_id || !filing_type)
      return bad("payroll_period_id & filing_type required", { headers });

    const sb = supabaseAdmin();
    const { data: period, error: perr } = await sb
      .from("payroll_periods")
      .select("*")
      .eq("id", payroll_period_id)
      .single();
    if (perr || !period) return bad(perr?.message ?? "period not found", { headers, status: 404 });

    const { data: runs, error: rerr } = await sb
      .from("payroll_runs")
      .select("*")
      .eq("payroll_period_id", payroll_period_id);
    if (rerr) return bad(rerr.message, { headers, status: 500 });

    const { data: orgProfile } = await sb
      .from("org_statutory_profiles")
      .select("*")
      .eq("organization_id", period.organization_id)
      .single();

    const totals = (runs ?? []).reduce(
      (acc: any, r: any) => {
        acc.net += Number(r.net_pay || 0);
        acc.gross += Number(r.gross_earnings || 0);
        acc.pf_emp += Number(r.snapshot?.compliance?.pf?.employee || 0);
        acc.pf_empr += Number(r.snapshot?.compliance?.pf?.employer || 0);
        acc.esic_emp += Number(r.snapshot?.compliance?.esic?.employee || 0);
        acc.esic_empr += Number(r.snapshot?.compliance?.esic?.employer || 0);
        acc.pt += Number(r.pt_amount || 0);
        return acc;
      },
      { net: 0, gross: 0, pf_emp: 0, pf_empr: 0, esic_emp: 0, esic_empr: 0, pt: 0 },
    );

    const prompt = [
      {
        text:
          `Create challan/export guidance for filing_type=${filing_type} for month=${period.month}, year=${period.year}.`,
      },
      { text: `Totals: ${JSON.stringify(totals)}` },
      { text: `Organization statutory: ${JSON.stringify(orgProfile)}` },
      {
        text:
          `Output JSON {checklist:[...], file_suggestion:{filename,mime,format:'csv'|'txt'|'json',body}, hints:[...]}. ` +
          `File body should be the final downloadable content (e.g., CSV rows).`,
      },
    ];
    let parsed: any = {};
    try {
      parsed = JSON.parse(await gemini(prompt));
    } catch {
      parsed = { checklist: [], file_suggestion: null, hints: [] };
    }

    // (Optional) upload file to storage for file_url — omitted here for brevity.
    const { data: filing, error: ferr } = await sb
      .from("statutory_filings")
      .insert({
        payroll_period_id,
        filing_type,
        status: "generated",
        file_url: null,
        payload: parsed,
        generated_at: new Date().toISOString(),
        generated_by: generated_by ?? null,
      })
      .select()
      .single();
    if (ferr) return bad(ferr.message, { headers, status: 500 });

    return ok(filing, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-challan-assist'));