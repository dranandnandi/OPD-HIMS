import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-attendance-import-validate-apply/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

type In = { batch_id: string; action: "validate" | "apply"; approver_id?: string };

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { batch_id, action, approver_id } = await readJson<In>(req);
    if (!batch_id || !action) return bad("batch_id & action required", { headers });

    const sb = supabaseAdmin();
    const { data: batch, error: berr } = await sb
      .from("attendance_import_batches")
      .select("*")
      .eq("id", batch_id)
      .single();
    if (berr || !batch)
      return bad(berr?.message ?? "batch not found", { headers, status: 404 });

    const { data: rows, error: rerr } = await sb
      .from("attendance_import_rows")
      .select("*")
      .eq("batch_id", batch_id);
    if (rerr) return bad(rerr.message, { headers, status: 500 });

    // AI validation (soft); we also do hard checks below.
    let validation: any = { errors: [], warnings: [] };
    try {
      const prompt = [
        {
          text:
            `Validate attendance rows for ${batch.month}/${batch.year}. ` +
            `Rules: payable_days <= calendar days; non-negative values; ot_hours reasonable.`,
        },
        { text: `Rows sample:\n${(rows ?? []).slice(0, 50).map((r) => JSON.stringify(r.normalized)).join("\n")}` },
        { text: `Return JSON {errors:[{rowIndex,message}], warnings:[{rowIndex,message}]}` },
      ];
      validation = JSON.parse(await gemini(prompt));
    } catch {
      validation = { errors: [], warnings: [] };
    }

    // Hard checks
    const calDays = new Date(batch.year, batch.month, 0).getDate();
    for (const [i, row] of (rows ?? []).entries()) {
      const n = row.normalized || {};
      const payable = Number(n.payable_days ?? n.present_days ?? 0);
      if (payable > calDays)
        validation.errors.push({
          rowIndex: i,
          message: `Payable days ${payable} > days in month ${calDays}`,
        });
      for (const k of ["payable_days", "present_days", "lop_days", "paid_leaves", "ot_hours", "late_count"]) {
        if (n[k] != null && Number(n[k]) < 0)
          validation.errors.push({ rowIndex: i, message: `${k} negative` });
      }
    }

    if (action === "validate") {
      await sb
        .from("attendance_import_batches")
        .update({ status: validation.errors?.length ? "mapped" : "validated" })
        .eq("id", batch_id);
      return ok(validation, { headers });
    }

    // APPLY
    if (validation.errors?.length)
      return bad("Resolve validation errors before apply", { headers, status: 422 });

    const rowsByUser = new Map<string, any>();
    for (const row of rows ?? []) {
      const uid = row.user_id;
      if (!uid) continue;
      const n = row.normalized || {};
      const payload = {
        payable_days: Number(n.payable_days ?? n.present_days ?? 0),
        lop_days: Number(n.lop_days ?? 0),
        paid_leaves: Number(n.paid_leaves ?? 0),
        ot_hours: Number(n.ot_hours ?? 0),
        late_count: Number(n.late_count ?? 0),
        remarks: n.remarks ?? null,
      };
      rowsByUser.set(uid, payload);
    }

    const upserts = Array.from(rowsByUser.entries()).map(([user_id, payload]) => ({
      organization_id: batch.organization_id,
      user_id,
      month: batch.month,
      year: batch.year,
      source_batch_id: batch.id,
      payload,
      approved_by: approver_id ?? null,
      approved_at: new Date().toISOString(),
    }));

    for (const u of upserts) {
      const { error } = await sb
        .from("attendance_monthly_overrides")
        .upsert(u, { onConflict: "organization_id,user_id,month,year" });
      if (error) return bad(error.message, { headers, status: 500 });
    }

    await sb
      .from("attendance_import_batches")
      .update({ status: "applied" })
      .eq("id", batch_id);

    return ok({ applied: upserts.length }, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-attendance-import-validate-apply'));