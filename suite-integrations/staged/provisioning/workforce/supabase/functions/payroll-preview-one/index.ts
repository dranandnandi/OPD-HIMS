import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/payroll-preview-one/index.ts
import { supabaseAdmin, readJson, ok, bad, cors } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const { user_id, month, year, state } = await readJson(req);
    if (!user_id || !month || !year || !state)
      return bad("user_id, month, year, state required", { headers });

    const sb = supabaseAdmin();
    const { data: comps, error: e1 } = await sb.rpc("fn_eval_components", {
      p_user: user_id,
      p_month: month,
      p_year: year,
    });
    if (e1) return bad(e1.message, { headers, status: 500 });

    const { data: compli, error: e2 } = await sb.rpc("fn_apply_compliance", {
      p_user: user_id,
      p_month: month,
      p_year: year,
      p_components: comps,
      p_state: state,
    });
    if (e2) return bad(e2.message, { headers, status: 500 });

    const { data: att, error: e3 } = await sb.rpc("fn_resolve_attendance_basis", {
      p_user: user_id,
      p_month: month,
      p_year: year,
    });
    if (e3) return bad(e3.message, { headers, status: 500 });

    return ok(
      { components: comps, compliance: compli, attendance_basis: att },
      { headers },
    );
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'payroll-preview-one'));
