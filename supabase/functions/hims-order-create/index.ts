import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lab-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type HimsPatient = {
  external_id?: string;
  name?: string;
  age?: number;
  gender?: string;
  phone?: string;
};

type HimsTest = {
  name?: string;
};

type TestMaster = {
  id: string;
  name: string;
  category: string | null;
  type: string | null;
};

type TestPrice = {
  test_id: string;
  price: number | null;
  cost: number | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function acronym(value: string): string {
  return normalize(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
}

function scoreTestName(himsName: string, limsName: string): number {
  const input = normalize(himsName);
  const target = normalize(limsName);

  if (!input || !target) return 0;
  if (input === target) return 1;
  if (input === acronym(target) || acronym(input) === target) return 0.92;
  if (target.includes(input) || input.includes(target)) return 0.86;

  const inputTokens = new Set(input.split(" "));
  const targetTokens = new Set(target.split(" "));
  const intersection =
    [...inputTokens].filter((token) => targetTokens.has(token)).length;
  const union = new Set([...inputTokens, ...targetTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchTests(requestedTests: HimsTest[], masterTests: TestMaster[]) {
  const matched: Array<{
    hims_name: string;
    lims_name: string;
    confidence: number;
    test_id: string;
  }> = [];
  const unmatched: Array<{ hims_name: string; reason: string }> = [];

  for (const test of requestedTests) {
    const himsName = String(test?.name || "").trim();
    if (!himsName) {
      unmatched.push({ hims_name: "", reason: "Missing test name" });
      continue;
    }

    let best: { test: TestMaster; confidence: number } | null = null;
    for (const masterTest of masterTests) {
      const confidence = scoreTestName(himsName, masterTest.name);
      if (!best || confidence > best.confidence) {
        best = { test: masterTest, confidence };
      }
    }

    if (best && best.confidence >= 0.72) {
      matched.push({
        hims_name: himsName,
        lims_name: best.test.name,
        confidence: Number(best.confidence.toFixed(2)),
        test_id: best.test.id,
      });
    } else {
      unmatched.push({
        hims_name: himsName,
        reason: "No confident LIMS test match",
      });
    }
  }

  return { matched, unmatched };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function formatSampleDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(/ /g, "-");
}

async function buildSampleId(supabase: any, clinicId: string): Promise<string> {
  const dateLabel = formatSampleDate();
  const prefix = `LAB-${dateLabel}-`;
  const { count, error } = await supabase
    .from("hims_lab_orders")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .ilike("sample_id", `${prefix}%`);

  if (error) {
    console.error("hims-order-create sample count error:", error);
  }

  return `${prefix}${String((count || 0) + 1).padStart(3, "0")}`;
}

function sanitizeGender(gender?: string): "male" | "female" | "other" {
  const normalized = normalize(gender || "");
  if (normalized === "male" || normalized === "m") return "male";
  if (normalized === "female" || normalized === "f") return "female";
  return "other";
}

function generateBillNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `BILL-${year}${month}${day}-${Date.now().toString().slice(-6)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = req.headers.get("x-lab-api-key")?.trim();
    if (!apiKey) {
      return json({ error: "x-lab-api-key header is required" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const keyHash = await sha256(apiKey);
    const { data: apiKeyRecord, error: apiKeyError } = await supabase
      .from("lab_api_keys")
      .select("id, lab_id, is_active")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (apiKeyError || !apiKeyRecord) {
      return json({ error: "Unauthorized" }, 401);
    }

    const clinicId = apiKeyRecord.lab_id;
    const { data: clinicSettings, error: clinicError } = await supabase
      .from("clinic_settings")
      .select("id, lab_test_integration_enabled")
      .eq("id", clinicId)
      .single();

    if (clinicError || !clinicSettings) {
      return json({ error: "Clinic not found" }, 404);
    }

    if (!clinicSettings.lab_test_integration_enabled) {
      return json(
        { error: "Lab test integration is disabled for this clinic" },
        403,
      );
    }

    const body = await req.json();
    const externalOrderId = String(body.external_order_id || "").trim();
    const patient: HimsPatient = body.patient || {};
    const tests: HimsTest[] = Array.isArray(body.tests) ? body.tests : [];

    if (!externalOrderId || !patient?.name || tests.length === 0) {
      return json(
        {
          error:
            "external_order_id, patient.name, and at least one test are required",
        },
        400,
      );
    }

    const { data: existingOrder } = await supabase
      .from("hims_lab_orders")
      .select("id, sample_id, status, matched_tests, unmatched_tests")
      .eq("clinic_id", clinicId)
      .eq("external_order_id", externalOrderId)
      .maybeSingle();

    if (existingOrder) {
      return json({
        success: true,
        order: {
          id: existingOrder.id,
          sample_id: existingOrder.sample_id,
          status: existingOrder.status,
        },
        tests: {
          matched: existingOrder.matched_tests || [],
          unmatched: existingOrder.unmatched_tests || [],
        },
        idempotent: true,
      });
    }

    let patientId: string | null = null;
    const phone = String(patient.phone || "").trim();
    if (phone) {
      const { data: existingPatient } = await supabase
        .from("patients")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("phone", phone)
        .maybeSingle();

      patientId = existingPatient?.id || null;
    }

    if (!patientId) {
      const fallbackPhone = phone ||
        `external:${patient.external_id || externalOrderId}`;
      const { data: newPatient, error: patientError } = await supabase
        .from("patients")
        .insert({
          clinic_id: clinicId,
          name: patient.name,
          phone: fallbackPhone,
          age: Number.isFinite(patient.age) ? patient.age : null,
          gender: sanitizeGender(patient.gender),
        })
        .select("id")
        .single();

      if (patientError || !newPatient) {
        console.error("hims-order-create patient insert error:", patientError);
        return json({ error: "Failed to register patient" }, 500);
      }

      patientId = newPatient.id;
    }

    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        doctor_id: null,
        date: new Date().toISOString(),
        chief_complaint: "Lab order from HIMS",
        doctor_notes: body.referring_doctor
          ? `Referring doctor: ${body.referring_doctor}`
          : null,
        advice: [],
        vitals: {},
      })
      .select("id")
      .single();

    if (visitError || !visit) {
      console.error("hims-order-create visit insert error:", visitError);
      return json({ error: "Failed to create lab visit" }, 500);
    }

    const { data: masterTests, error: testsError } = await supabase
      .from("tests_master")
      .select("id, name, category, type")
      .eq("is_active", true);

    if (testsError) {
      console.error("hims-order-create tests fetch error:", testsError);
      return json({ error: "Failed to load LIMS test catalog" }, 500);
    }

    const { matched, unmatched } = matchTests(tests, masterTests || []);

    if (matched.length > 0) {
      const { error: orderedError } = await supabase.from("tests_ordered")
        .insert(
          matched.map((test) => ({
            clinic_id: clinicId,
            visit_id: visit.id,
            test_id: test.test_id,
            testName: test.lims_name,
            test_type: "lab",
            status: "ordered",
            urgency: "routine",
            instructions: `HIMS order ${externalOrderId}`,
          })),
        );

      if (orderedError) {
        console.error(
          "hims-order-create tests_ordered insert error:",
          orderedError,
        );
        return json({ error: "Failed to create test orders" }, 500);
      }
    }

    let billId: string | null = null;
    if (matched.length > 0) {
      const matchedTestIds = matched.map((test) => test.test_id);
      const { data: priceRows } = await supabase
        .from("clinic_test_prices")
        .select("test_id, price, cost")
        .eq("clinic_id", clinicId)
        .in("test_id", matchedTestIds);

      const priceByTestId = new Map(
        ((priceRows || []) as TestPrice[]).map((
          row,
        ) => [row.test_id, Number(row.price || 0)]),
      );
      const billItems = matched.map((test) => {
        const unitPrice = priceByTestId.get(test.test_id) || 0;
        return {
          item_type: "test",
          item_name: test.lims_name,
          quantity: 1,
          unit_price: unitPrice,
          total_price: unitPrice,
          amount: unitPrice,
          discount: 0,
          tax: 0,
          clinic_id: clinicId,
        };
      });
      const totalAmount = billItems.reduce(
        (sum, item) => sum + item.total_price,
        0,
      );

      const { data: bill, error: billError } = await supabase
        .from("bills")
        .insert({
          clinic_id: clinicId,
          visit_id: visit.id,
          patient_id: patientId,
          bill_number: generateBillNumber(),
          total_amount: totalAmount,
          paid_amount: 0,
          balance_amount: totalAmount,
          status: "pending",
          bill_date: new Date().toISOString(),
          notes: `HIMS lab order ${externalOrderId}`,
        })
        .select("id")
        .single();

      if (billError || !bill) {
        console.error("hims-order-create bill insert error:", billError);
        return json({ error: "Failed to create bill" }, 500);
      }

      billId = bill.id;
      const { error: billItemsError } = await supabase.from("bill_items")
        .insert(
          billItems.map((item) => ({
            ...item,
            bill_id: bill.id,
          })),
        );

      if (billItemsError) {
        console.error(
          "hims-order-create bill items insert error:",
          billItemsError,
        );
        return json({ error: "Failed to create bill items" }, 500);
      }
    }

    const sampleId = await buildSampleId(supabase, clinicId);
    const { data: order, error: orderError } = await supabase
      .from("hims_lab_orders")
      .insert({
        clinic_id: clinicId,
        external_order_id: externalOrderId,
        patient_id: patientId,
        visit_id: visit.id,
        bill_id: billId,
        sample_id: sampleId,
        status: "Order Created",
        referring_doctor: body.referring_doctor || null,
        pdf_callback_url: body.pdf_callback_url || null,
        request_payload: body,
        matched_tests: matched.map(({ test_id: _testId, ...test }) => test),
        unmatched_tests: unmatched,
      })
      .select("id, sample_id, status")
      .single();

    if (orderError || !order) {
      console.error("hims-order-create order insert error:", orderError);
      return json({ error: "Failed to create HIMS lab order" }, 500);
    }

    return json({
      success: true,
      order: {
        id: order.id,
        sample_id: order.sample_id,
        status: order.status,
      },
      tests: {
        matched: matched.map(({ test_id: _testId, ...test }) => test),
        unmatched,
      },
    });
  } catch (err) {
    console.error("hims-order-create unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
