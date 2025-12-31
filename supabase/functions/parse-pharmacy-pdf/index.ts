// supabase/functions/parse-pharmacy-pdf/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper: always return JSON with CORS
const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rid = crypto.randomUUID(); // request id for tracing
  const t0 = Date.now();
  console.info(`[${rid}] Incoming request ${req.method} ${new URL(req.url).pathname}`);

  try {
    // Ensure content-type & body
    const ctype = req.headers.get("content-type") || "";
    if (!ctype.includes("application/json")) {
      console.warn(`[${rid}] Unsupported Content-Type: ${ctype}`);
      return json({ error: "Content-Type must be application/json" }, 415);
    }

    // Parse JSON safely
    let parsed: any;
    try {
      parsed = await req.json();
    } catch (e) {
      console.error(`[${rid}] JSON parse error`, e);
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { pdfBase64, fileName } = parsed || {};
    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      console.warn(`[${rid}] Missing pdfBase64`);
      return json({ error: "pdfBase64 (base64-encoded PDF) is required" }, 400);
    }

    // Secret
    const apiKey = Deno.env.get("ALLGOOGLE_KEY");
    if (!apiKey) {
      console.error(`[${rid}] Missing ALLGOOGLE_KEY secret`);
      return json({ error: "Server not configured: ALLGOOGLE_KEY missing" }, 500);
    }

    // Clean base64 (strip data URL prefix if present)
    const cleanB64 = pdfBase64.replace(/^data:[^;]+;base64,/, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
      console.warn(`[${rid}] pdfBase64 looks malformed (non-base64 chars)`);
    }

    // ==== STEP 1: Ask Gemini 2.0 Flash directly with inline PDF ====
    const prompt = `
You are an expert pharmacy invoice extraction AI. Read the attached PDF and output ONLY a JSON object with this schema:
{
  "invoiceInfo": {
    "supplierName": "string|null",
    "invoiceNumber": "string|null",
    "invoiceDate": "YYYY-MM-DD|null",
    "totalAmount": "number|null"
  },
  "medicines": [
    {
      "medicineName": "string (required)",
      "quantity": "number (required, positive integer)",
      "unitCostPrice": "number (required, positive)",
      "totalCostPrice": "number|null",
      "batchNumber": "string|null",
      "expiryDate": "YYYY-MM-DD|null",
      "manufacturer": "string|null",
      "strength": "string|null",
      "packSize": "string|null"
    }
  ]
}
Rules:
- If unknown, use null.
- Dates => YYYY-MM-DD.
- Prices => numeric only.
- Ensure at least medicineName, quantity, unitCostPrice for each line.
- Return ONLY the JSON. No extra text.`.trim();

    // Model: Gemini 2.0 Flash Experimental
    const model = "gemini-2.0-flash-exp";

    const geminiReq = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                data: cleanB64,
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        // temperature: 0.1 // optional
      }
    };

    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const g0 = Date.now();
    const geminiRes = await fetch(geminiURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReq),
    });

    let geminiData: any;
    try {
      geminiData = await geminiRes.json();
    } catch (e) {
      console.error(`[${rid}] Gemini JSON parse error`, e);
      return json({ error: "Gemini response not JSON", details: String(e) }, 502);
    }

    if (!geminiRes.ok || geminiData.error) {
      console.error(`[${rid}] Gemini error`, {
        status: geminiRes.status,
        statusText: geminiRes.statusText,
        error: geminiData.error,
      });
      return json(
        {
          error: "Gemini API error",
          status: geminiRes.status,
          details: geminiData.error || geminiData,
        },
        502,
      );
    }

    const generatedText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!generatedText) {
      console.warn(`[${rid}] Gemini returned empty text`);
      return json({ error: "No output from Gemini" }, 502);
    }

    // Extract JSON from LLM output
    let extracted: any;
    try {
      extracted = JSON.parse(generatedText);
    } catch (e) {
      try {
        const m = generatedText.match(/\{[\s\S]*\}$/);
        if (!m) throw new Error("No JSON object found");
        extracted = JSON.parse(m[0]);
      } catch (e2) {
        console.error(`[${rid}] Gemini JSON extraction failed`, { sample: generatedText.slice(0, 400) });
        // return json({ error: "Invalid JSON returned by Gemini" }, 502);
        // Fallback to empty
        extracted = { invoiceInfo: {}, medicines: [] };
      }
    }

    // Validate & clean
    const safe = (x: any, def: any) => (x === null || x === undefined ? def : x);
    const invoiceInfo = {
      supplierName: safe(extracted?.invoiceInfo?.supplierName, null),
      invoiceNumber: safe(extracted?.invoiceInfo?.invoiceNumber, null),
      invoiceDate: safe(extracted?.invoiceInfo?.invoiceDate, null),
      totalAmount:
        typeof extracted?.invoiceInfo?.totalAmount === "number"
          ? extracted.invoiceInfo.totalAmount
          : null,
    };

    const medicines = Array.isArray(extracted?.medicines)
      ? extracted.medicines
        .map((m: any) => {
          const quantity = Number.isFinite(m?.quantity) && m.quantity > 0 ? m.quantity : 1;
          const unit = Number.isFinite(m?.unitCostPrice) && m.unitCostPrice > 0 ? m.unitCostPrice : 0;
          return {
            medicineName: (m?.medicineName || "").trim(),
            quantity,
            unitCostPrice: unit,
            totalCostPrice:
              Number.isFinite(m?.totalCostPrice) ? m.totalCostPrice : quantity * unit,
            batchNumber: safe(m?.batchNumber, null),
            expiryDate: safe(m?.expiryDate, null),
            manufacturer: safe(m?.manufacturer, null),
            strength: safe(m?.strength, null),
            packSize: safe(m?.packSize, null),
          };
        })
        .filter((m: any) => m.medicineName)
      : [];

    let confidence = 0.5;
    if (invoiceInfo.supplierName) confidence += 0.1;
    if (invoiceInfo.invoiceNumber) confidence += 0.1;
    if (medicines.length > 0) confidence += 0.2;
    if (medicines.some((m: any) => m.batchNumber)) confidence += 0.1;

    const durationMs = Date.now() - t0;
    console.info(`[${rid}] Done in ${durationMs} ms; Gemini took ${Date.now() - g0} ms`);

    return json({
      success: true,
      requestId: rid,
      fileName: fileName || "invoice.pdf",
      extractedData: { invoiceInfo, medicines },
      confidence: Math.min(confidence, 1),
    });
  } catch (err: any) {
    console.error(`[${rid}] Uncaught error`, err);
    return json(
      {
        error: "Failed to process pharmacy PDF",
        requestId: rid,
        details: String(err?.message || err),
      },
      500,
    );
  }
});
