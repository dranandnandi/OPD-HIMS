import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/generate-payslip-pdf/index.ts
//
// On-demand payslip PDF generation via PDF.co.
// Called from frontend when user clicks "📄 Payslip" per employee.
// Architecture mirrors the OPD generate-pdf-from-html function:
//   1. Cache check  → return instantly if already generated
//   2. Fetch data   → payroll_runs + users + payroll_periods + org profile
//   3. Build HTML   → inline-styled A4 payslip (industry-standard Indian format)
//   4. PDF.co       → async mode + polling
//   5. Stabilize    → verify file is ready
//   6. Return URL   → respond immediately with temp URL
//   7. Background   → download → upload to "payslips" bucket → save permanent URL

import { supabaseAdmin, readJson, cors } from "../_shared/utils.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function ok<T>(data: T, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: true, data }), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function bad(message: string, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: (init as any).status ?? 400,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

// ─── currency / number formatters ────────────────────────────────────────────

function fmt(n: number): string {
  return isFinite(n)
    ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function fmtInt(n: number): string {
  return isFinite(n) ? String(Math.round(n)) : "—";
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildPayslipHtml(
  run: any,
  periodMonth: number,
  periodYear: number,
  employeeName: string,
  employeeCode: string | null,
  designation: string | null,
  department: string | null,
  orgName: string,
  orgAddress: string,
): string {
  const MONTHS = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const monthName = MONTHS[periodMonth] ?? String(periodMonth);

  // ── Components from snapshot (it's a JSONB array) ──
  const snapshot: { code: string; name: string; type: string; amount: number }[] =
    Array.isArray(run.snapshot) ? run.snapshot : (run.snapshot?.components ?? run.snapshot?.breakdown ?? []);

  const earnings = snapshot.filter((c) => c.type === "earning" || c.type === "earnings");
  const deductions = snapshot.filter((c) =>
    c.type === "deduction" || c.type === "deductions" || c.type === "statutory_deduction"
  );
  const employerCosts = snapshot.filter((c) => c.type === "employer_cost");

  // ── Attendance from attendance_summary (separate column in payroll_runs) ──
  const att = run.attendance_summary ?? {};
  const workingDays  = Number(att.working_days ?? 0);
  const presentDays  = Number(att.present_days ?? att.payable_days ?? 0);
  const lopDays      = Number(att.lop_days ?? 0);
  const paidLeaves   = Number(att.paid_leaves ?? 0);
  const payableDays  = Number(att.payable_days ?? (workingDays - lopDays));
  const lateCount    = Number(att.late_count ?? 0);
  const otHours      = Number(att.ot_hours ?? 0);

  // ── Totals ──
  const gross: number    = Number(run.gross_earnings ?? 0);
  const totalDed: number = Number(run.total_deductions ?? 0);
  const net: number      = Number(run.net_pay ?? 0);
  const empCost: number  = Number(run.employer_cost ?? 0);

  // ── Build earnings rows ──
  const earningRows = earnings.length > 0
    ? earnings.map((c) =>
        `<tr><td>${c.name}</td><td class="r">${fmt(Math.abs(Number(c.amount)))}</td></tr>`
      ).join("")
    : `<tr><td>Basic / Gross</td><td class="r">${fmt(gross)}</td></tr>`;

  // ── Build deduction rows (PF, ESIC, PT, TDS, any custom) ──
  const dedRows = deductions.length > 0
    ? deductions.map((c) =>
        `<tr><td>${c.name}</td><td class="r">${fmt(Math.abs(Number(c.amount)))}</td></tr>`
      ).join("")
    : `<tr><td colspan="2" class="empty-msg">No deductions</td></tr>`;

  // ── Build employer cost rows ──
  const employerRows = employerCosts.length > 0
    ? employerCosts.map((c) =>
        `<tr><td>${c.name}</td><td class="r">${fmt(Math.abs(Number(c.amount)))}</td></tr>`
      ).join("")
    : "";

  // ── Pay date (last day of the month) ──
  const payDate = new Date(periodYear, periodMonth, 0);
  const payDateStr = payDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payslip - ${employeeName} - ${monthName} ${periodYear}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; padding: 0; }
    .page { max-width: 794px; margin: 0 auto; padding: 28px 32px; }

    /* ── Header ── */
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #1e3a5f; margin-bottom: 0; }
    .company-name { font-size: 20px; font-weight: 800; color: #1e3a5f; letter-spacing: -0.3px; }
    .company-addr { font-size: 9.5px; color: #6b7280; margin-top: 3px; max-width: 320px; }
    .badge { text-align: right; }
    .badge .title { font-size: 18px; font-weight: 800; color: #1e3a5f; letter-spacing: 2px; }
    .badge .period { font-size: 10.5px; color: #64748b; margin-top: 2px; font-weight: 500; }
    .badge .pay-date { font-size: 9.5px; color: #94a3b8; margin-top: 1px; }

    /* ── Info strip ── */
    .info-strip { display: grid; grid-template-columns: 1fr 1fr; background: #f0f4f8; border-bottom: 1px solid #d1d9e6; }
    .info-strip .col { padding: 12px 16px; }
    .info-strip .col:first-child { border-right: 1px solid #d1d9e6; }
    .info-strip h4 { font-size: 8.5px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px; font-weight: 700; }
    .info-row { display: flex; justify-content: space-between; padding: 2.5px 0; font-size: 10.5px; }
    .info-row .lbl { color: #64748b; }
    .info-row .val { font-weight: 600; color: #1e293b; }

    /* ── Attendance strip ── */
    .att-strip { display: grid; grid-template-columns: repeat(6, 1fr); border-bottom: 2px solid #1e3a5f; }
    .att-cell { text-align: center; padding: 10px 4px; border-right: 1px solid #e2e8f0; }
    .att-cell:last-child { border-right: none; }
    .att-num { font-size: 20px; font-weight: 800; color: #1e3a5f; }
    .att-num.green { color: #059669; }
    .att-num.amber { color: #d97706; }
    .att-num.red { color: #dc2626; }
    .att-num.blue { color: #2563eb; }
    .att-lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-top: 2px; font-weight: 600; }

    /* ── Earnings / Deductions tables ── */
    .pay-section { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #e2e8f0; }
    .pay-section .col { }
    .pay-section .col:first-child { border-right: 1px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e3a5f; color: #fff; padding: 7px 10px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    th.r { text-align: right; }
    td { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; font-size: 10.5px; }
    td.r { text-align: right; font-variant-numeric: tabular-nums; }
    tr:nth-child(even) td { background: #fafbfc; }
    .total-row td { font-weight: 700; background: #e8f0fe !important; border-top: 2px solid #1e3a5f; font-size: 11px; color: #1e3a5f; }
    .empty-msg { color: #94a3b8; font-style: italic; text-align: center; padding: 12px; }

    /* ── Net Pay banner ── */
    .net-banner { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: #fff; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }
    .net-label { font-size: 12px; font-weight: 600; opacity: 0.9; }
    .net-amount { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }

    /* ── Employer cost section ── */
    .employer-section { background: #f8fafc; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; }
    .employer-section h4 { font-size: 8.5px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 700; margin-bottom: 6px; }
    .employer-grid { display: flex; gap: 24px; flex-wrap: wrap; }
    .employer-item { font-size: 10.5px; }
    .employer-item .emp-lbl { color: #64748b; }
    .employer-item .emp-val { font-weight: 700; color: #1e293b; margin-left: 4px; }
    .employer-total { margin-left: auto; font-size: 11px; font-weight: 700; color: #1e3a5f; }

    /* ── Footer ── */
    .footer { padding: 12px 0 0; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; margin-top: 12px; }

    /* ── Summary box between pay section and net pay ── */
    .summary-strip { display: grid; grid-template-columns: 1fr 1fr; background: #f0f4f8; border-bottom: 1px solid #d1d9e6; }
    .summary-strip .s-col { padding: 8px 16px; display: flex; justify-content: space-between; font-size: 11px; }
    .summary-strip .s-col:first-child { border-right: 1px solid #d1d9e6; }
    .summary-strip .s-lbl { color: #64748b; font-weight: 500; }
    .summary-strip .s-val { font-weight: 700; color: #1e3a5f; }
  </style>
</head>
<body>
<div class="page">

  <!-- ═══════════════ HEADER ═══════════════ -->
  <div class="header">
    <div>
      <div class="company-name">${orgName}</div>
      <div class="company-addr">${orgAddress ?? ""}</div>
    </div>
    <div class="badge">
      <div class="title">PAYSLIP</div>
      <div class="period">${monthName} ${periodYear}</div>
      <div class="pay-date">Pay Date: ${payDateStr}</div>
    </div>
  </div>

  <!-- ═══════════════ EMPLOYEE INFO ═══════════════ -->
  <div class="info-strip">
    <div class="col">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="lbl">Name</span><span class="val">${employeeName}</span></div>
      ${employeeCode ? `<div class="info-row"><span class="lbl">Employee Code</span><span class="val">${employeeCode}</span></div>` : ""}
      ${designation ? `<div class="info-row"><span class="lbl">Designation</span><span class="val">${designation}</span></div>` : ""}
      ${department ? `<div class="info-row"><span class="lbl">Department</span><span class="val">${department}</span></div>` : ""}
    </div>
    <div class="col">
      <h4>Pay Summary</h4>
      <div class="info-row"><span class="lbl">Gross Earnings</span><span class="val">₹${fmt(gross)}</span></div>
      <div class="info-row"><span class="lbl">Total Deductions</span><span class="val" style="color:#dc2626;">– ₹${fmt(totalDed)}</span></div>
      <div class="info-row" style="border-top:1px solid #cbd5e1; padding-top:4px; margin-top:2px;">
        <span class="lbl" style="font-weight:700; color:#1e293b;">Net Pay</span>
        <span class="val" style="font-size:13px; color:#059669;">₹${fmt(net)}</span>
      </div>
    </div>
  </div>

  <!-- ═══════════════ ATTENDANCE SUMMARY ═══════════════ -->
  <div class="att-strip">
    <div class="att-cell">
      <div class="att-num">${fmtInt(workingDays)}</div>
      <div class="att-lbl">Working Days</div>
    </div>
    <div class="att-cell">
      <div class="att-num green">${fmtInt(presentDays)}</div>
      <div class="att-lbl">Present Days</div>
    </div>
    <div class="att-cell">
      <div class="att-num amber">${fmtInt(paidLeaves)}</div>
      <div class="att-lbl">Paid Leaves</div>
    </div>
    <div class="att-cell">
      <div class="att-num red">${fmtInt(lopDays)}</div>
      <div class="att-lbl">LOP / Absent</div>
    </div>
    <div class="att-cell">
      <div class="att-num blue">${fmtInt(payableDays)}</div>
      <div class="att-lbl">Payable Days</div>
    </div>
    <div class="att-cell">
      <div class="att-num">${fmtInt(lateCount)}</div>
      <div class="att-lbl">Late Count</div>
    </div>
  </div>

  <!-- ═══════════════ EARNINGS vs DEDUCTIONS ═══════════════ -->
  <div class="pay-section">
    <div class="col">
      <table>
        <thead><tr><th>Earnings</th><th class="r">Amount (₹)</th></tr></thead>
        <tbody>
          ${earningRows}
          <tr class="total-row"><td>Gross Earnings</td><td class="r">₹${fmt(gross)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="col">
      <table>
        <thead><tr><th>Deductions</th><th class="r">Amount (₹)</th></tr></thead>
        <tbody>
          ${dedRows}
          <tr class="total-row"><td>Total Deductions</td><td class="r">₹${fmt(totalDed)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══════════════ NET PAY BANNER ═══════════════ -->
  <div class="net-banner">
    <span class="net-label">NET PAY (Take Home)</span>
    <span class="net-amount">₹${fmt(net)}</span>
  </div>

  <!-- ═══════════════ EMPLOYER CONTRIBUTIONS ═══════════════ -->
  ${employerRows ? `
  <div class="employer-section">
    <h4>Employer Contributions (CTC Components — Not deducted from salary)</h4>
    <div class="employer-grid">
      ${employerCosts.map((c) =>
        `<div class="employer-item"><span class="emp-lbl">${c.name}:</span><span class="emp-val">₹${fmt(Math.abs(Number(c.amount)))}</span></div>`
      ).join("")}
      <div class="employer-total">Total CTC Cost: ₹${fmt(empCost)}</div>
    </div>
  </div>
  ` : ""}

  <!-- ═══════════════ FOOTER ═══════════════ -->
  <div class="footer">
    This is a system-generated payslip and does not require a signature. &nbsp;|&nbsp; ${orgName}
  </div>

</div>
</body>
</html>`;
}

// ─── main handler ─────────────────────────────────────────────────────────────

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const { runId, forceRegenerate } = await readJson(req);
    if (!runId) return bad("Missing runId", { headers });

    const sb = supabaseAdmin();

    // ── 1. Cache check ────────────────────────────────────────────────────────
    if (!forceRegenerate) {
      const { data: cached } = await sb
        .from("payroll_runs")
        .select("pdf_url")
        .eq("id", runId)
        .single();

      if (cached?.pdf_url) {
        console.log("[PAYSLIP PDF] ✅ Returning cached URL");
        return ok({ url: cached.pdf_url, cached: true }, { headers });
      }
    }

    // ── 2. Fetch payroll run + joined data ────────────────────────────────────
    //    FIX: Now includes attendance_summary
    const { data: run, error: runErr } = await sb
      .from("payroll_runs")
      .select(`
        id, user_id, gross_earnings, total_deductions, net_pay, employer_cost,
        snapshot, attendance_summary,
        payroll_period:payroll_periods(month, year, organization_id)
      `)
      .eq("id", runId)
      .single();

    if (runErr || !run) throw new Error(`Payroll run not found: ${runErr?.message}`);

    const period = (run as any).payroll_period;
    const orgId = period?.organization_id;

    // Fetch employee details — only columns that exist in users table
    const { data: emp } = await sb
      .from("users")
      .select("name, full_name, department")
      .eq("id", run.user_id)
      .single();

    // Fetch org profile for company name/address
    const { data: orgProfile } = await sb
      .from("org_statutory_profiles")
      .select("company_name, address")
      .eq("organization_id", orgId)
      .maybeSingle();

    // Fallback: try organizations table
    let orgName = orgProfile?.company_name ?? "";
    let orgAddress = orgProfile?.address ?? "";
    if (!orgName) {
      const { data: org } = await sb
        .from("organizations")
        .select("name, address")
        .eq("id", orgId)
        .maybeSingle();
      orgName = org?.name ?? "Organization";
      orgAddress = org?.address ?? "";
    }

    const employeeName = (emp as any)?.full_name ?? emp?.name ?? "Employee";
    const employeeCode: string | null = null; // users table doesn't have employee_code yet
    const designation: string | null = null;   // users table doesn't have designation yet
    const department   = emp?.department ?? null;
    const periodMonth: number = period?.month ?? 1;
    const periodYear: number  = period?.year ?? new Date().getFullYear();

    // ── 3. Build HTML ─────────────────────────────────────────────────────────
    const htmlContent = buildPayslipHtml(
      run, periodMonth, periodYear,
      employeeName, employeeCode, designation, department,
      orgName, orgAddress,
    );

    const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const safeName = employeeName.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `Payslip_${safeName}_${MONTHS[periodMonth]}_${periodYear}.pdf`;

    // ── 4. PDF.co API ─────────────────────────────────────────────────────────
    const pdfCoApiKey = Deno.env.get("PDF_CO_API");
    if (!pdfCoApiKey) throw new Error("PDF_CO_API secret is not set");

    const pdfCoRes = await runtimeFetch("https://api.pdf.co/v1/pdf/convert/from/html", {
      method: "POST",
      headers: {
        "x-api-key": pdfCoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: filename,
        html: htmlContent,
        async: true,
        papersize: "A4",
        margins: "20px",
        printbackground: true,
        mediatype: "print",
      }),
    });

    if (!pdfCoRes.ok) {
      throw new Error(`PDF.co error ${pdfCoRes.status}: ${await pdfCoRes.text()}`);
    }

    const pdfCoData = await pdfCoRes.json();
    let pdfUrl: string | null = null;

    if (pdfCoData.url && pdfCoData.error === false) {
      // Sync response
      pdfUrl = pdfCoData.url;
    } else if (pdfCoData.jobId) {
      // ── 5. Async polling ──────────────────────────────────────────────────
      const MAX_ATTEMPTS = 60;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`[PAYSLIP PDF] Poll attempt ${attempt}/${MAX_ATTEMPTS}`);
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await runtimeFetch(
          `https://api.pdf.co/v1/job/check?jobid=${pdfCoData.jobId}`,
          { headers: { "x-api-key": pdfCoApiKey } },
        );
        const status = await statusRes.json();
        if (status.status === "success" && status.url) {
          pdfUrl = status.url;
          break;
        }
        if (status.status === "error" || status.status === "failed") {
          throw new Error(`PDF.co job failed: ${status.message}`);
        }
      }
    }

    if (!pdfUrl) throw new Error("PDF.co job timed out or returned no URL");

    // ── 6. Stabilize: verify file is actually ready ───────────────────────
    await new Promise((r) => setTimeout(r, 3000));
    let stabilized = false;
    for (let i = 0; i < 10; i++) {
      const check = await runtimeFetch(pdfUrl);
      if (check.ok && check.headers.get("content-type")?.includes("application/pdf")) {
        stabilized = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!stabilized) throw new Error("PDF failed to stabilize on PDF.co servers. Please retry.");

    // ── 7. Return temp URL immediately ────────────────────────────────────
    // Background task persists to Supabase Storage
    const persistToStorage = async () => {
      try {
        await new Promise((r) => setTimeout(r, 6000)); // Extra S3 stabilization

        const dlRes = await runtimeFetch(pdfUrl!);
        if (!dlRes.ok) throw new Error(`Download failed: HTTP ${dlRes.status}`);
        const blob = await dlRes.blob();

        const storagePath = `${orgId}/${periodYear}-${String(periodMonth).padStart(2, "0")}/${filename}`;

        const { error: uploadErr } = await sb.storage
          .from("payslips")
          .upload(storagePath, blob, { contentType: "application/pdf", upsert: true });

        if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

        const { data: { publicUrl } } = sb.storage.from("payslips").getPublicUrl(storagePath);

        await sb.from("payroll_runs").update({ pdf_url: publicUrl }).eq("id", runId);

        console.log("[PAYSLIP PDF] ✅ Persisted:", publicUrl);
      } catch (err) {
        console.error("[PAYSLIP PDF] Background persist error:", err);
      }
    };

    persistToStorage().catch((e) => console.error("[PAYSLIP PDF] Background error:", e));

    return ok({ url: pdfUrl, filename, temporary: true }, { headers });
  } catch (error) {
    console.error("[PAYSLIP PDF] Error:", error);
    return bad(
      error instanceof Error ? error.message : "Unknown error generating payslip PDF",
      { headers, status: 500 } as any,
    );
  }
}, 'workforce', 'generate-payslip-pdf'));
