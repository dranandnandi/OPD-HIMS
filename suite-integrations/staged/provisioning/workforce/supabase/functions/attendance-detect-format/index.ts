import { withSuiteClient, guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
// deno-lint-ignore-file no-explicit-any
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
// SheetJS for XLSX reading
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
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

function isCSV(name?: string) {
  const n = (name || "").toLowerCase();
  return n.endsWith(".csv") || n.endsWith(".txt");
}
function isXLSX(name?: string) {
  const n = (name || "").toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xls");
}

// Very tolerant CSV parser for detection (no quotes edge cases solved here because sample is small)
function parseCSV(text: string, maxRows = 10): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1, 1 + maxRows).map((ln) => ln.split(","));
  return { headers, rows };
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
    const { batch_id } = await req.json();
    if (!batch_id) return bad("batch_id required");

    const supabase = sb();
    const { data: batch, error } = await supabase
      .from("attendance_import_batches")
      .select("id, file_url")
      .eq("id", batch_id)
      .single();
    if (error) throw error;
    if (!batch.file_url) return bad("file_url missing on batch. Upload file first.");

    // Fetch file bytes
    const res = await runtimeFetch(batch.file_url);
    if (!res.ok) throw new Error("Unable to download source file");
    const buf = await res.arrayBuffer();

    // Decide CSV/XLSX
    let detected: any = { headers: [] as string[], sample: [] as string[][], dialect: {} };
    const urlLower = batch.file_url.toLowerCase();
    if (isCSV(urlLower)) {
      const text = new TextDecoder().decode(new Uint8Array(buf));
      const { headers, rows } = parseCSV(text, 8);
      detected.headers = headers;
      detected.sample = rows;
      detected.dialect = { type: "csv", delimiter: "," };
    } else if (isXLSX(urlLower)) {
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const headers = (aoa[0] || []).map((h) => String(h || "").trim());
      const sample = (aoa.slice(1, 9) || []).map((r) => r.map((c) => String(c ?? "")));
      detected.headers = headers;
      detected.sample = sample;
      detected.dialect = { type: "xlsx", sheet: wb.SheetNames[0] };
    } else {
      // fallback: try CSV parse
      const text = new TextDecoder().decode(new Uint8Array(buf));
      const { headers, rows } = parseCSV(text, 8);
      detected.headers = headers;
      detected.sample = rows;
      detected.dialect = { type: "csv-unknown" };
    }

    const { error: uErr } = await supabase
      .from("attendance_import_batches")
      .update({ detected_format: detected })
      .eq("id", batch_id);
    if (uErr) throw uErr;

    return json({ headers: detected.headers, sample: detected.sample, dialect: detected.dialect });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}, 'workforce', 'attendance-detect-format'));