import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
// deno-lint-ignore-file no-explicit-any
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
const createClient=withSuiteClient(dsBase_createClient);


const BUCKET = "attendance-imports";

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
    const { batch_id } = await req.json();
    if (!batch_id) return bad("batch_id required");

    const supabase = sb();

    // Fetch batch for path info
    const { data: batch, error: bErr } = await supabase
      .from("attendance_import_batches")
      .select("id, organization_id, month, year, file_url")
      .eq("id", batch_id)
      .single();
    if (bErr) throw bErr;

    // 1) Delete staged rows
    const { error: rErr } = await supabase
      .from("attendance_import_rows")
      .delete()
      .eq("batch_id", batch_id);
    if (rErr) throw rErr;

    // 2) Delete storage objects under prefix org/year-month/batch_id/*
    // List is not available directly; we can derive path prefix from file_url if present
    if (batch.file_url) {
      // public URL is typically: <proj>/storage/v1/object/public/attendance-imports/<path>
      const prefix = batch.file_url.split("/attendance-imports/")[1];
      if (prefix) {
        const dir = prefix.split("/").slice(0, -1).join("/"); // up to batch_id
        // We can't list with SDK v2; instead, delete known object if we only uploaded one file.
        // If you upload multiple, consider storing an objects array on batch.
        const { error: delErr } = await supabase.storage.from(BUCKET).remove([prefix]);
        if (delErr) {
          // ignore; continue with batch deletion
        }
      }
    }

    // 3) Delete batch
    const { error: dErr } = await supabase
      .from("attendance_import_batches")
      .delete()
      .eq("id", batch_id);
    if (dErr) throw dErr;

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}, 'workforce', 'attendance-discard-batch'));