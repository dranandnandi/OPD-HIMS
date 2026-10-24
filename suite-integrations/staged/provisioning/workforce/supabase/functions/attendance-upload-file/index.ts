import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
// deno-lint-ignore-file no-explicit-any
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
const createClient=withSuiteClient(dsBase_createClient);


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
    const { organization_id, month, year, source, filename } = await req.json();
    if (!organization_id || !month || !year || !filename) return bad("organization_id, month, year, filename required");

    const supabase = sb();
    const { data, error } = await supabase
      .from("attendance_import_batches")
      .insert({
        organization_id,
        month,
        year,
        source: source ?? "excel",
        file_url: null,
        detected_format: null,
        column_mapping: null,
        status: "uploaded",
      })
      .select("*")
      .single();

    if (error) throw error;

    // Return the new batch; file will be uploaded in the next step.
    return json(data);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}, 'workforce', 'attendance-upload-file'));