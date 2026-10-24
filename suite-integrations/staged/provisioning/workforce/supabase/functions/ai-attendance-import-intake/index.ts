import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/ai-attendance-import-intake/index.ts
import { supabaseAdmin, readJson, ok, bad, cors, gemini } from "../_shared/utils.ts";

type IntakeIn = {
  organization_id: string;
  month: number;
  year: number;
  file_url: string; // CSV URL for now
};

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { organization_id, month, year, file_url } = await readJson<IntakeIn>(req);
    if (!organization_id || !month || !year || !file_url)
      return bad("organization_id, month, year, file_url required", { headers });

    const csvRes = await runtimeFetch(file_url);
    if (!csvRes.ok) return bad("Failed to fetch file_url", { headers, status: 400 });
    const csv = await csvRes.text();

    const sb = supabaseAdmin();

    const { data: users, error: uerr } = await sb
      .from("users")
      .select("id,name,email,phone,organization_id")
      .eq("organization_id", organization_id);
    if (uerr) return bad(uerr.message, { headers, status: 500 });

    const prompt = [
      { text: "Map an attendance CSV to a canonical monthly schema per employee." },
      { text: `CSV (first 1000 chars):\n${csv.slice(0, 1000)}` },
      {
        text:
          `Employee directory (subset):\n` +
          users
            .slice(0, 100)
            .map((u) => `${u.id}|${u.name}|${u.email}|${u.phone}`)
            .join("\n"),
      },
      {
        text:
          `1) Detect header columns and propose mapping for: employee_key, present_days, lop_days, paid_leaves, ot_hours, late_count, remarks.\n` +
          `2) Normalize to monthly aggregates (one row per employee).\n` +
          `3) Fuzzy match employees by name/email/phone → user_id with confidence 0..1.\n` +
          `Return JSON {detected_format:{...}, column_mapping:{...}, rows:[{raw,normalized,{user_id,match_confidence}}]}.`,
      },
    ];
    const text = await gemini(prompt);
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return bad("AI mapping parse failed", { headers, status: 500 });
    }
    const { detected_format, column_mapping, rows } = parsed;

    const { data: batch, error: berr } = await sb
      .from("attendance_import_batches")
      .insert({
        organization_id,
        month,
        year,
        source: "excel",
        file_url,
        detected_format,
        column_mapping,
        status: "mapped",
      })
      .select()
      .single();
    if (berr) return bad(berr.message, { headers, status: 500 });

    const payload = (rows ?? []).map((r: any) => ({
      batch_id: batch.id,
      raw: r.raw ?? r.normalized,
      normalized: r.normalized,
      user_id: r.user_id ?? null,
      match_confidence: r.match_confidence ?? null,
      validation_errors: null,
      is_duplicate: false,
      will_apply: true,
    }));

    if (payload.length) {
      const { error: rerr } = await sb.from("attendance_import_rows").insert(payload);
      if (rerr) return bad(rerr.message, { headers, status: 500 });
    }

    return ok({ batch_id: batch.id, inserted: payload.length }, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-attendance-import-intake'));