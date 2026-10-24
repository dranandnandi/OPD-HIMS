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
function extFromName(n: string) { const i = n.lastIndexOf("."); return i >= 0 ? n.slice(i + 1).toLowerCase() : ""; }

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

    const form = await req.formData();
    const file = form.get("file") as unknown as File;
    const batch_id = String(form.get("batch_id") || "");

    if (!file || !batch_id) return bad("file and batch_id required");

    const supabase = sb();

    // Load batch for routing path
    const { data: batch, error: bErr } = await supabase
      .from("attendance_import_batches")
      .select("organization_id, month, year")
      .eq("id", batch_id)
      .single();
    if (bErr) throw bErr;

    const fileName = (file as any).name || `upload.${extFromName((file as any).name || "csv") || "csv"}`;
    const objectPath = `${batch.organization_id}/${batch.year}-${String(batch.month).padStart(2, "0")}/${batch_id}/${fileName}`;

    const arrayBuf = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, new Uint8Array(arrayBuf), { upsert: true });
    if (upErr) throw upErr;

    // Public URL
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    const file_url = pub.publicUrl;

    const { error: uErr } = await supabase
      .from("attendance_import_batches")
      .update({ file_url })
      .eq("id", batch_id);
    if (uErr) throw uErr;

    return json({ ok: true, file_url });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}, 'workforce', 'attendance-upload-file-chunk'));