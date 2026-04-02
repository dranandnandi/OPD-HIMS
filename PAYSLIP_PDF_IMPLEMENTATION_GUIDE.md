# Payslip PDF Implementation Guide

> Based on the working PDF pipeline from the OPD Management HIMS app.\
> This document explains **how the current system works** and **how to replicate
> it** for payslip generation in the Payroll/Attendance app.

---

## 1. How the Current OPD PDF System Works (Architecture)

```
Frontend (React)
    │
    │  1. Calls pdfService.ts (fetch with Bearer token)
    ▼
Supabase Edge Function: generate-pdf-from-html
    │
    │  2. Builds HTML string (prescription / bill layout)
    │  3. Calls PDF.co API → gets temporary PDF URL
    │  4. Returns temp URL to frontend immediately (user sees PDF fast)
    │
    │  5. Background task (fire-and-forget):
    │     ├── Downloads PDF blob from PDF.co temp URL
    │     ├── Uploads blob to Supabase Storage bucket "pdfs"
    │     └── Saves permanent public URL back to DB (visits / bills table)
    ▼
Supabase Storage Bucket: "pdfs"
    │
    └── Permanent public URL stored in DB column (pdf_url / print_pdf_url)
```

### Key Design Decisions

| Decision                         | Reason                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| **PDF.co** (not browser print)   | Headers, footers, pagination, and custom margins work reliably                 |
| **Edge Function** generates HTML | Keeps secrets (API key) server-side; no client-side PDF libraries needed       |
| **Async mode + polling**         | PDF.co processes large/complex HTML asynchronously; polling prevents timeout   |
| **Temp URL returned first**      | User gets the PDF fast; storage happens in the background                      |
| **URL cached in DB**             | Next time same record is opened, no re-generation needed (cache check first)   |
| **Storage bucket**               | PDF.co temp URLs expire; permanent public URLs are needed for WhatsApp/sharing |

---

## 2. Environment Variables Required

Set these in your **Supabase Edge Function secrets** (`supabase secrets set`):

| Variable                    | Value               | Used For                                |
| --------------------------- | ------------------- | --------------------------------------- |
| `PDF_CO_API`                | Your PDF.co API key | Authenticating PDF generation requests  |
| `SUPABASE_URL`              | Your project URL    | Admin client init inside Edge Function  |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key    | Uploading to storage & updating DB rows |

Set these in your **frontend `.env`**:

| Variable                 | Value                     |
| ------------------------ | ------------------------- |
| `VITE_SUPABASE_URL`      | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key         |

---

## 3. Supabase Storage Bucket Setup

In the OPD app, the bucket is named **`pdfs`** with this folder structure:

```
pdfs/
├── visits/{visit_id}/display/Prescription_Name_Date.pdf
├── visits/{visit_id}/print/Print_Name_Date.pdf
├── visits/{visit_id}/compact/CompactRx_Name_Date.pdf
└── bills/{bill_id}/display/Bill_BillNo_Name.pdf
```

### For the Payroll App, use this structure:

```
pdfs/                          ← reuse same bucket OR create "payslips" bucket
└── payslips/
    └── {employee_id}/
        └── {year}-{month}/
            └── Payslip_EmpName_Month_Year.pdf
```

### Steps to create the bucket:

1. Go to **Supabase Dashboard → Storage**
2. Create bucket named `payslips` (or reuse `pdfs`)
3. Set it to **Public** (so the URL is directly accessible without auth)
4. Add a Storage Policy to allow the **service_role** to upload files

---

## 4. Database Column to Store the URL

Add a column to your `payslips` (or `salary_records`) table:

```sql
ALTER TABLE payslips
  ADD COLUMN pdf_url TEXT DEFAULT NULL;
```

The Edge Function will update this column after background upload.\
On the next request for the same payslip, it returns the cached URL instantly
(no re-generation).

---

## 5. The Edge Function: `generate-payslip-pdf`

Create: `supabase/functions/generate-payslip-pdf/index.ts`

### Full Implementation Pattern

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { payslipId, forceRegenerate } = await req.json();

        // --- 1. Init Supabase Admin Client ---
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabase = createClient(supabaseUrl, supabaseKey);

        // --- 2. Cache Check: Return existing URL if available ---
        if (!forceRegenerate) {
            const { data: existing } = await supabase
                .from("payslips")
                .select("pdf_url")
                .eq("id", payslipId)
                .single();

            if (existing?.pdf_url) {
                console.log("[PAYSLIP PDF] ✅ Returning cached URL");
                return new Response(
                    JSON.stringify({
                        success: true,
                        url: existing.pdf_url,
                        cached: true,
                    }),
                    {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json",
                        },
                    },
                );
            }
        }

        // --- 3. Fetch payslip data from DB ---
        const { data: payslip, error: fetchError } = await supabase
            .from("payslips")
            .select(`
        *,
        employee:employees(name, designation, department, employee_code, bank_account, pan_number),
        company:company_settings(name, address, logo_url)
      `)
            .eq("id", payslipId)
            .single();

        if (fetchError || !payslip) {
            throw new Error(`Payslip not found: ${fetchError?.message}`);
        }

        // --- 4. Build HTML ---
        const filename = `Payslip_${
            payslip.employee.name.replace(/[^a-zA-Z0-9]/g, "_")
        }_${payslip.month}_${payslip.year}.pdf`;
        const htmlContent = buildPayslipHtml(payslip); // See Section 6 below

        // --- 5. Call PDF.co API ---
        const pdfCoApiKey = Deno.env.get("PDF_CO_API");
        if (!pdfCoApiKey) throw new Error("PDF_CO_API key not set");

        const pdfCoResponse = await fetch(
            "https://api.pdf.co/v1/pdf/convert/from/html",
            {
                method: "POST",
                headers: {
                    "x-api-key": pdfCoApiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: filename,
                    html: htmlContent,
                    async: true, // Use async mode (required for complex HTML)
                    papersize: "A4",
                    margins: "20px",
                    printbackground: true,
                    mediatype: "print",
                }),
            },
        );

        if (!pdfCoResponse.ok) {
            const errorText = await pdfCoResponse.text();
            throw new Error(
                `PDF.co API Error: ${pdfCoResponse.status} - ${errorText}`,
            );
        }

        const pdfCoData = await pdfCoResponse.json();
        let pdfUrl: string | null = null;

        // --- 6. Handle Sync or Async PDF.co Response ---
        if (pdfCoData.url && pdfCoData.error === false) {
            // Synchronous: URL returned directly
            pdfUrl = pdfCoData.url;
        } else if (pdfCoData.jobId) {
            // Asynchronous: Poll until complete
            const maxPollAttempts = 60; // ~2 minutes max
            const pollInterval = 2000; // 2 seconds

            for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
                console.log(
                    `[PAYSLIP PDF] Polling attempt ${attempt}/${maxPollAttempts}...`,
                );
                await new Promise((r) => setTimeout(r, pollInterval));

                const statusRes = await fetch(
                    `https://api.pdf.co/v1/job/check?jobid=${pdfCoData.jobId}`,
                    {
                        headers: { "x-api-key": pdfCoApiKey },
                    },
                );
                const statusData = await statusRes.json();

                if (statusData.status === "success" && statusData.url) {
                    pdfUrl = statusData.url;
                    break;
                } else if (
                    statusData.status === "error" ||
                    statusData.status === "failed"
                ) {
                    throw new Error(`PDF.co job failed: ${statusData.message}`);
                }
            }
        }

        if (!pdfUrl) throw new Error("PDF.co job timed out");

        // --- 7. Safety delay + verify file is actually ready ---
        await new Promise((r) => setTimeout(r, 3000));
        let isReady = false;
        for (let i = 1; i <= 10; i++) {
            const check = await fetch(pdfUrl);
            if (
                check.ok &&
                check.headers.get("content-type")?.includes("application/pdf")
            ) {
                isReady = true;
                break;
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
        if (!isReady) {
            throw new Error(
                "PDF failed to stabilize on PDF.co servers. Please retry.",
            );
        }

        // --- 8. Return temp URL immediately to frontend ---
        // Background task will persist to storage
        const persistToStorage = async () => {
            try {
                await new Promise((r) => setTimeout(r, 6000)); // Extra S3 stabilization

                // Download PDF
                const res = await fetch(pdfUrl!);
                if (!res.ok) {
                    throw new Error(`Download failed: HTTP ${res.status}`);
                }
                const pdfBlob = await res.blob();

                // Upload to Supabase Storage
                const storagePath =
                    `payslips/${payslip.employee_id}/${payslip.year}-${payslip.month}/${filename}`;
                const { error: uploadError } = await supabase.storage
                    .from("payslips") // ← Your bucket name
                    .upload(storagePath, pdfBlob, {
                        contentType: "application/pdf",
                        upsert: true,
                    });

                if (uploadError) {
                    throw new Error(`Upload failed: ${uploadError.message}`);
                }

                // Get permanent public URL
                const { data: { publicUrl } } = supabase.storage
                    .from("payslips")
                    .getPublicUrl(storagePath);

                // Save URL to database
                await supabase
                    .from("payslips")
                    .update({ pdf_url: publicUrl })
                    .eq("id", payslipId);

                console.log(
                    "[PAYSLIP PDF] ✅ Persisted to storage:",
                    publicUrl,
                );
            } catch (err) {
                console.error("[PAYSLIP PDF] Background persist error:", err);
            }
        };

        persistToStorage().catch((e) =>
            console.error("[PAYSLIP PDF] Background task error:", e)
        );

        return new Response(
            JSON.stringify({
                success: true,
                url: pdfUrl,
                filename,
                temporary: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("[PAYSLIP PDF] Error:", error);
        return new Response(
            JSON.stringify({
                error: "Failed to generate payslip PDF",
                details: error instanceof Error
                    ? error.message
                    : "Unknown error",
            }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    }
});
```

---

## 6. The HTML Template for Payslip (`buildPayslipHtml`)

This function returns the full HTML string that PDF.co will convert.\
Keep all styles **inline or in a `<style>` tag** — no external CSS files.

```typescript
function buildPayslipHtml(payslip: any): string {
    const {
        employee,
        company,
        month,
        year,
        basic_salary,
        hra,
        other_allowances,
        pf_deduction,
        esi_deduction,
        tds_deduction,
        other_deductions,
        gross_salary,
        total_deductions,
        net_salary,
        working_days,
        present_days,
        leave_days,
        lop_days,
        bank_account,
        pan_number,
    } = payslip;

    const monthName = new Date(year, month - 1, 1).toLocaleString("en-IN", {
        month: "long",
    });

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Payslip - ${employee.name} - ${monthName} ${year}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #333; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center;
              border-bottom: 2px solid #1a56db; padding-bottom: 12px; margin-bottom: 16px; }
    .company-name { font-size: 20px; font-weight: bold; color: #1a56db; }
    .payslip-title { font-size: 14px; font-weight: bold; text-align: right; }
    .payslip-period { font-size: 11px; color: #666; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .info-box { border: 1px solid #ddd; border-radius: 4px; padding: 10px; }
    .info-box h4 { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 6px; }
    .info-row { display: flex; justify-content: space-between; padding: 2px 0; }
    .info-label { color: #666; }
    .info-value { font-weight: 600; }
    .attendance-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .att-box { border: 1px solid #ddd; border-radius: 4px; padding: 8px; text-align: center; }
    .att-number { font-size: 20px; font-weight: bold; color: #1a56db; }
    .att-label { font-size: 10px; color: #666; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #1a56db; color: white; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
    td { padding: 7px 8px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) td { background: #f9fafb; }
    .total-row td { font-weight: bold; background: #eff6ff !important; border-top: 2px solid #1a56db; }
    .net-pay-box { background: #1a56db; color: white; padding: 16px; border-radius: 6px;
                   display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .net-pay-label { font-size: 14px; font-weight: bold; }
    .net-pay-amount { font-size: 22px; font-weight: bold; }
    .footer-note { font-size: 10px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div>
      <div class="company-name">${company.name}</div>
      <div style="font-size:11px; color:#666;">${company.address}</div>
    </div>
    <div>
      <div class="payslip-title">PAYSLIP</div>
      <div class="payslip-period">${monthName} ${year}</div>
    </div>
  </div>

  <!-- EMPLOYEE INFO -->
  <div class="info-grid">
    <div class="info-box">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="info-label">Name</span><span class="info-value">${employee.name}</span></div>
      <div class="info-row"><span class="info-label">Employee Code</span><span class="info-value">${employee.employee_code}</span></div>
      <div class="info-row"><span class="info-label">Designation</span><span class="info-value">${employee.designation}</span></div>
      <div class="info-row"><span class="info-label">Department</span><span class="info-value">${employee.department}</span></div>
    </div>
    <div class="info-box">
      <h4>Payment Details</h4>
      <div class="info-row"><span class="info-label">Bank Account</span><span class="info-value">${
        bank_account || "N/A"
    }</span></div>
      <div class="info-row"><span class="info-label">PAN Number</span><span class="info-value">${
        pan_number || "N/A"
    }</span></div>
      <div class="info-row"><span class="info-label">Pay Period</span><span class="info-value">${monthName} ${year}</span></div>
    </div>
  </div>

  <!-- ATTENDANCE SUMMARY -->
  <div class="attendance-row">
    <div class="att-box">
      <div class="att-number">${working_days}</div>
      <div class="att-label">Working Days</div>
    </div>
    <div class="att-box">
      <div class="att-number" style="color:#16a34a;">${present_days}</div>
      <div class="att-label">Days Present</div>
    </div>
    <div class="att-box">
      <div class="att-number" style="color:#f59e0b;">${leave_days}</div>
      <div class="att-label">Leave Days</div>
    </div>
    <div class="att-box">
      <div class="att-number" style="color:#dc2626;">${lop_days}</div>
      <div class="att-label">LOP Days</div>
    </div>
  </div>

  <!-- EARNINGS & DEDUCTIONS ----->
  <div class="two-col">
    <table>
      <thead><tr><th>Earnings</th><th style="text-align:right;">Amount (₹)</th></tr></thead>
      <tbody>
        <tr><td>Basic Salary</td><td style="text-align:right;">${
        Number(basic_salary).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
        <tr><td>HRA</td><td style="text-align:right;">${
        Number(hra).toLocaleString("en-IN", { minimumFractionDigits: 2 })
    }</td></tr>
        <tr><td>Other Allowances</td><td style="text-align:right;">${
        Number(other_allowances).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
        <tr class="total-row"><td>Gross Salary</td><td style="text-align:right;">₹${
        Number(gross_salary).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Deductions</th><th style="text-align:right;">Amount (₹)</th></tr></thead>
      <tbody>
        <tr><td>PF</td><td style="text-align:right;">${
        Number(pf_deduction).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
        <tr><td>ESI</td><td style="text-align:right;">${
        Number(esi_deduction).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
        <tr><td>TDS</td><td style="text-align:right;">${
        Number(tds_deduction).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
        <tr><td>Other Deductions</td><td style="text-align:right;">${
        Number(other_deductions).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
        <tr class="total-row"><td>Total Deductions</td><td style="text-align:right;">₹${
        Number(total_deductions).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
        })
    }</td></tr>
      </tbody>
    </table>
  </div>

  <!-- NET PAY -->
  <div class="net-pay-box">
    <span class="net-pay-label">💰 Net Pay (Take Home)</span>
    <span class="net-pay-amount">₹${
        Number(net_salary).toLocaleString("en-IN", { minimumFractionDigits: 2 })
    }</span>
  </div>

  <div class="footer-note">
    This is a computer-generated payslip and does not require a signature. | ${company.name}
  </div>

</body>
</html>`;
}
```

---

## 7. Frontend Service (`payslipPdfService.ts`)

Create: `src/services/payslipPdfService.ts`

```typescript
import { supabase } from "../lib/supabase";

export const payslipPdfService = {
    async generatePayslipPdf(
        payslipId: string,
        options?: { forceRegenerate?: boolean },
    ): Promise<string> {
        const { data: { session }, error: sessionError } = await supabase.auth
            .getSession();
        if (sessionError || !session) throw new Error("Not authenticated");

        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-payslip-pdf`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    payslipId,
                    forceRegenerate: options?.forceRegenerate ?? false,
                }),
            },
        );

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "PDF generation failed");
        }

        const result = await response.json();
        if (!result.success) throw new Error(result.error || "Unknown error");

        return result.url; // Temp URL (quickly available); permanent URL saved to DB in background
    },
};
```

---

## 8. Using It in a React Component

```tsx
import { useState } from "react";
import { payslipPdfService } from "../services/payslipPdfService";

function PayslipRow({ payslip }) {
    const [loading, setLoading] = useState(false);

    const handleGeneratePdf = async () => {
        setLoading(true);
        try {
            const pdfUrl = await payslipPdfService.generatePayslipPdf(
                payslip.id,
            );
            window.open(pdfUrl, "_blank"); // Opens PDF in new tab
        } catch (err) {
            alert("Failed to generate payslip: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <span>
                {payslip.employee_name} — {payslip.month}/{payslip.year}
            </span>
            <button onClick={handleGeneratePdf} disabled={loading}>
                {loading ? "Generating..." : "📄 Download Payslip"}
            </button>
        </div>
    );
}
```

---

## 9. Deploy the Edge Function

```bash
# From your payroll project root
supabase functions deploy generate-payslip-pdf --no-verify-jwt

# Set secrets
supabase secrets set PDF_CO_API=your_pdfco_api_key_here
```

> **`--no-verify-jwt`** is only needed if you call this function publicly (e.g.,
> employee self-service portal). For admin-only use, remove the flag and the JWT
> header token will be verified automatically.

---

## 10. Checklist Before Testing

- [ ] `PDF_CO_API` secret is set in Supabase
- [ ] `SUPABASE_SERVICE_ROLE_KEY` secret is set in Supabase
- [ ] Storage bucket `payslips` is created and set to **Public**
- [ ] `payslips` table has a `pdf_url TEXT` column
- [ ] Edge function is deployed:
      `supabase functions deploy generate-payslip-pdf`
- [ ] `.env` has `VITE_SUPABASE_URL` pointing to the payroll app's Supabase
      project

---

## 11. Common Issues & Fixes

| Issue                        | Cause                                  | Fix                                                |
| ---------------------------- | -------------------------------------- | -------------------------------------------------- |
| PDF.co returns 401           | Wrong or missing API key               | Check `PDF_CO_API` secret                          |
| `Not authenticated` error    | No session / wrong anon key            | Check `VITE_SUPABASE_URL` and user login           |
| PDF shows blank / broken     | PDF.co temp URL expired before storage | Add retry logic; check network                     |
| Storage upload fails         | Missing bucket or wrong permissions    | Ensure bucket exists and service role can write    |
| PDF renders with wrong fonts | External fonts not loaded              | Embed `@import` Google Fonts in `<style>` tag      |
| Payslip not found in DB      | Wrong `payslipId` passed               | Log the ID before fetch, verify table/column names |
