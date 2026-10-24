import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
// deno-lint-ignore-file no-explicit-any
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
const createClient=withSuiteClient(dsBase_createClient);


type Batch = {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  source: "excel" | "csv" | "biometric" | null;
  file_url: string | null;
  detected_format: any | null;
  column_mapping: any | null;
  status: "uploaded" | "mapped" | "validated" | "applied" | "rejected";
  created_at: string;
  created_by: string | null;
};

type StageSummary = {
  total_rows: number;
  matched_users: number;
  avg_match_confidence: number;
  duplicates: number;
  errors: number;
  will_apply_rows: number;
};

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
  });
}
function bad(msg: string, status = 400) { return json({ error: msg }, status); }

async function stageSummary(batch_id: string): Promise<StageSummary> {
  const supabase = sb();
  const { data, error } = await supabase
    .from("attendance_import_rows")
    .select("user_id, match_confidence, is_duplicate, validation_errors", { count: "exact" })
    .eq("batch_id", batch_id);

  if (error) throw error;

  const total = data?.length ?? 0;
  const matched = data?.filter((r) => !!r.user_id).length ?? 0;
  const avg = total
    ? Math.round(
        (data!.reduce((a, r) => a + (Number(r.match_confidence) || 0), 0) / total) * 100
      ) / 100
    : 0;
  const dup = data?.filter((r) => r.is_duplicate).length ?? 0;
  const err = data?.filter((r) => Array.isArray(r.validation_errors) && r.validation_errors.length > 0).length ?? 0;
  const canApply = data?.filter(
    (r) => !r.is_duplicate && (!r.validation_errors || r.validation_errors.length === 0) && r.user_id
  ).length ?? 0;

  return {
    total_rows: total,
    matched_users: matched,
    avg_match_confidence: avg,
    duplicates: dup,
    errors: err,
    will_apply_rows: canApply,
  };
}

Deno.serve(guardEdge(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: { 
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }});
    }
    if (req.method !== "POST") return bad("POST required", 405);
    const { organization_id, month, year } = await req.json();
    if (!organization_id || !month || !year) return bad("organization_id, month, year required");

    const supabase = sb();
    const { data: batch, error } = await supabase
      .from("attendance_import_batches")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("month", month)
      .eq("year", year)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Batch>();

    if (error) throw error;

    if (!batch) return json({ batch: null, detect: null, stage: null });

    const detect = batch.detected_format;
    const stage = await stageSummary(batch.id);

    return json({ batch, detect, stage });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}, 'workforce', 'attendance-latest-batch-for-period'));