import { guardEdge } from '../_shared/suite-runtime-guard.ts';
import { supabaseAdmin, readJson, ok, bad, cors } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { organization_id, month, year } = await readJson(req);
    if (!organization_id || !month || !year) {
      return bad("organization_id, month, year required", { headers });
    }

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);
    const periodStartISO = periodStart.toISOString().slice(0, 10);
    const periodEndISO = periodEnd.toISOString().slice(0, 10);

    const sb = supabaseAdmin();

    const { data: users, error: usersErr } = await sb
      .from("users")
      .select("id, name, email, department")
      .eq("organization_id", organization_id);

    if (usersErr) return bad(usersErr.message, { headers, status: 500 });

    const { data: compRows, error: compErr } = await sb
      .from("employee_compensation")
      .select("user_id")
      .eq("organization_id", organization_id)
      .lte("effective_from", periodEndISO)
      .or(`effective_to.is.null,effective_to.gte.${periodStartISO}`);

    if (compErr) return bad(compErr.message, { headers, status: 500 });

    const uniqueUsers = new Set((compRows || []).map((row) => row.user_id));
    const missingUsers = (users || []).filter((user) => !uniqueUsers.has(user.id));

    return ok(
      {
        employees_total: (users || []).length,
        employees_with_compensation: uniqueUsers.size,
        missing_compensation_users: missingUsers,
      },
      { headers },
    );
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'payroll-effective-compensation'));
