import { withSuiteClient, guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
// deno-lint-ignore-file no-explicit-any
import { createClient as dsBase_createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
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
function parseCSV(text: string): string[][] {
  // simple CSV splitter; assumes commas (detector wrote dialect earlier)
  return text.split(/\r?\n/).filter(Boolean).map((ln) => ln.split(","));
}

function toISODate(val: string): string | null {
  // accepts dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, mm/dd/yyyy -> normalize
  const s = (val || "").trim();
  if (!s) return null;
  // iso direct
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    const mm = mdy[1].padStart(2, "0");
    const dd = mdy[2].padStart(2, "0");
    const yyyy = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // Excel serial?
  const n = Number(s);
  if (!Number.isNaN(n) && n > 59 && n < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30)); // Excel serial epoch
    const ms = epoch.getTime() + n * 86400000;
    const dt = new Date(ms);
    return dt.toISOString().slice(0,10);
  }
  return null;
}

async function resolveUserIdByCode(supabase: any, code: string): Promise<{ id: string|null, confidence: number }> {
  if (!code) return { id: null, confidence: 0 };
  // Try users.employee_code, fallback to users.external_code
  const { data, error } = await supabase
    .from("users")
    .select("id, employee_code, external_code")
    .or(`employee_code.eq.${code},external_code.eq.${code}`)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return { id: null, confidence: 0 };
  const row = data[0];
  const confidence =
    row.employee_code === code ? 100
    : row.external_code === code ? 90
    : 80;
  return { id: row.id, confidence };
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

    // Load batch with mapping + file
    const { data: batch, error: bErr } = await supabase
      .from("attendance_import_batches")
      .select("id, organization_id, month, year, file_url, detected_format, column_mapping, status")
      .eq("id", batch_id)
      .single();
    if (bErr) throw bErr;

    if (!batch.file_url) return bad("file_url missing. Upload file first.");
    if (!batch.detected_format || !batch.detected_format.headers) return bad("detected_format missing. Run detect first.");
    if (!batch.column_mapping) return bad("column_mapping missing. Save mapping first.");

    // Download file
    const res = await runtimeFetch(batch.file_url);
    if (!res.ok) throw new Error("Unable to download source file");
    const buf = await res.arrayBuffer();

    // Build header index
    const headers: string[] = batch.detected_format.headers;
    const H = headers.map((h) => String(h || "").trim());
    const ix = (name?: string) => {
      if (!name) return -1;
      const i = H.findIndex((h) => h === name || h.toLowerCase() === String(name).toLowerCase());
      return i;
    };

    // Read grid (rows as array of strings)
    let grid: string[][];
    if (isCSV(batch.file_url)) {
      const text = new TextDecoder().decode(new Uint8Array(buf));
      grid = parseCSV(text);
    } else if (isXLSX(batch.file_url)) {
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      grid = aoa.map((r) => r.map((c) => String(c ?? "")));
    } else {
      const text = new TextDecoder().decode(new Uint8Array(buf));
      grid = parseCSV(text);
    }
    if (grid.length < 2) return bad("No data rows found");

    // Remove header row
    const rows = grid.slice(1);

    // Clear any existing staged rows for this batch (idempotent re-run)
    await supabase.from("attendance_import_rows").delete().eq("batch_id", batch_id);

    // For duplicate detection inside this batch: map key "user_id|date"
    const seen = new Set<string>();

    // Indexes
    const m = batch.column_mapping;
    const iEmployeeCode = ix(m.employee_code);
    const iUser = ix(m.user_id);
    const iDate = ix(m.date);
    const iIn = ix(m.check_in);
    const iOut = ix(m.check_out);
    const iHours = ix(m.hours);
    const iOT = ix(m.overtime_hours);
    const iRemarks = ix(m.remarks);
    const iShift = ix(m.shift_code);
    const iBreak = ix(m.break_minutes);

    const inserts: any[] = [];

    for (const line of rows) {
      if (!line || line.length === 0) continue;

      const raw: Record<string, any> = {};
      H.forEach((h, j) => (raw[h] = line[j] ?? ""));

      const err: string[] = [];

      // Normalize fields
      const employee_code = iEmployeeCode >= 0 ? String(line[iEmployeeCode] || "").trim() : "";
      const user_hint = iUser >= 0 ? String(line[iUser] || "").trim() : "";
      const dateStr = iDate >= 0 ? String(line[iDate] || "").trim() : "";
      const isoDate = toISODate(dateStr);
      if (!isoDate) err.push("Invalid/missing date");

      // Times/hours
      const check_in = iIn >= 0 ? String(line[iIn] || "").trim() : "";
      const check_out = iOut >= 0 ? String(line[iOut] || "").trim() : "";
      const hours = iHours >= 0 ? Number(String(line[iHours] || "0").replace(/[^0-9\.]/g, "")) : 0;
      const overtime_hours = iOT >= 0 ? Number(String(line[iOT] || "0").replace(/[^0-9\.]/g, "")) : 0;
      const remarks = iRemarks >= 0 ? String(line[iRemarks] || "").trim() : "";
      const shift_code = iShift >= 0 ? String(line[iShift] || "").trim() : "";
      const break_minutes = iBreak >= 0 ? Number(String(line[iBreak] || "0").replace(/[^0-9\.]/g, "")) : 0;

      // Resolve user_id
      let user_id: string | null = null;
      let confidence = 0;
      if (user_hint) {
        // direct user id?
        if (/^[0-9a-fA-F-]{16,36}$/.test(user_hint)) {
          user_id = user_hint;
          confidence = 100;
        } else {
          const found = await resolveUserIdByCode(supabase, user_hint);
          user_id = found.id;
          confidence = found.confidence;
        }
      } else if (employee_code) {
        const found = await resolveUserIdByCode(supabase, employee_code);
        user_id = found.id;
        confidence = found.confidence;
      } else {
        err.push("No employee code or user id");
      }

      // Duplicate check (only if we have user & date)
      let is_duplicate = false;
      if (user_id && isoDate) {
        const key = `${user_id}|${isoDate}`;
        if (seen.has(key)) is_duplicate = true;
        seen.add(key);
      }

      // Basic validations
      if (!user_id) err.push("User not resolved");
      if (!isoDate) err.push("Date missing");
      if (!check_in && !hours) err.push("Neither check-in nor hours available");

      const normalized = {
        date: isoDate,
        check_in,
        check_out,
        hours,
        overtime_hours,
        remarks,
        shift_code,
        break_minutes,
      };

      inserts.push({
        batch_id,
        raw,
        normalized,
        user_id,
        match_confidence: confidence,
        is_duplicate,
        validation_errors: err.length ? err : null,
      });
    }

    // Bulk insert (chunk to avoid payload limits)
    const chunkSize = 1000;
    for (let i = 0; i < inserts.length; i += chunkSize) {
      const slice = inserts.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from("attendance_import_rows").insert(slice);
      if (insErr) throw insErr;
    }

    // Compute StageSummary
    const { data: staged, error: sErr } = await supabase
      .from("attendance_import_rows")
      .select("user_id, match_confidence, is_duplicate, validation_errors", { count: "exact" })
      .eq("batch_id", batch_id);
    if (sErr) throw sErr;

    const total = staged?.length ?? 0;
    const matched = staged?.filter((r) => !!r.user_id).length ?? 0;
    const avg = total ? Math.round((staged!.reduce((a, r) => a + (Number(r.match_confidence) || 0), 0) / total) * 100) / 100 : 0;
    const dup = staged?.filter((r) => r.is_duplicate).length ?? 0;
    const errRows = staged?.filter((r) => Array.isArray(r.validation_errors) && r.validation_errors.length > 0).length ?? 0;
    const canApply = staged?.filter(
      (r) => !r.is_duplicate && (!r.validation_errors || r.validation_errors.length === 0) && r.user_id
    ).length ?? 0;

    const summary = {
      total_rows: total,
      matched_users: matched,
      avg_match_confidence: avg,
      duplicates: dup,
      errors: errRows,
      will_apply_rows: canApply,
    };

    // Advance status
    const nextStatus = errRows === 0 ? "validated" : "mapped";
    const { error: uErr } = await supabase
      .from("attendance_import_batches")
      .update({ status: nextStatus })
      .eq("id", batch_id);
    if (uErr) throw uErr;

    return json(summary);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}, 'workforce', 'attendance-parse-and-stage'));