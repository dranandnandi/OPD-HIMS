import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/payroll-finalize-run/index.ts
import { supabaseAdmin, readJson, ok, bad, cors } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const { payroll_period_id, user_id, state } = await readJson(req);
    if (!payroll_period_id || !user_id || !state) {
      return bad("Missing payroll_period_id|user_id|state", { headers });
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("fn_finalize_run", {
      p_period: payroll_period_id,
      p_user: user_id,
      p_state: state,
    });
    if (error) return bad(error.message, { headers, status: 500 });
    return ok(data, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'payroll-finalize-run'));
