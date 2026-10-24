import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-attendance-basis-explain/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { organization_id, user_id, month, year } = await readJson(req);
    if (!organization_id || !user_id || !month || !year)
      return bad("org,user,month,year required", { headers });

    const sb = supabaseAdmin();

    const { data: ovr } = await sb
      .from("attendance_monthly_overrides")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("user_id", user_id)
      .eq("month", month)
      .eq("year", year)
      .maybeSingle();

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = `${year}-${String(month).padStart(2, "0")}-31`;
    const { data: punches } = await sb
      .from("attendance")
      .select("date,punch_in_time,punch_out_time,effective_hours,is_late,is_early_out,is_holiday,is_weekend")
      .eq("organization_id", organization_id)
      .eq("user_id", user_id)
      .gte("date", start)
      .lte("date", end);

    const prompt = [
      { text: `Explain monthly attendance basis for payroll. If overrides exist, prioritize them and contrast with raw punches.` },
      { text: `Overrides: ${JSON.stringify(ovr?.payload ?? null)}` },
      { text: `Punches sample: ${JSON.stringify((punches ?? []).slice(0, 20))}` },
      { text: `Return JSON {markdown:"..."} concise.` },
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
}, 'workforce', 'ai-attendance-basis-explain'));