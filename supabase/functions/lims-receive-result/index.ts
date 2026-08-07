import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lab-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LimsResultPayload {
  external_order_id: string;
  lims_order_id?: string;
  sample_id?: string;
  status: string;
  pdf_url?: string;
  pdf_base64?: string;
  results?: Array<{
    test_name: string;
    result: string;
    normal_range?: string;
    is_abnormal?: boolean;
    notes?: string;
  }>;
  completed_at?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body: LimsResultPayload = await req.json();

    if (!body.external_order_id) {
      return json({ error: "external_order_id is required" }, 400);
    }

    const { data: order, error: orderError } = await supabase
      .from("lims_outbound_orders")
      .select("id, clinic_id, visit_id, patient_id, status")
      .eq("external_order_id", body.external_order_id)
      .maybeSingle();

    if (orderError) {
      console.error("lims-receive-result order lookup error:", orderError);
      return json({ error: "Failed to look up order" }, 500);
    }

    if (!order) {
      return json(
        { error: `Order not found: ${body.external_order_id}` },
        404
      );
    }

    if (order.status === "completed") {
      return json({
        success: true,
        message: "Order already completed",
        order_id: order.id,
        idempotent: true,
      });
    }

    let pdfUrl = body.pdf_url;

    if (body.pdf_base64 && !pdfUrl) {
      try {
        const pdfBytes = Uint8Array.from(atob(body.pdf_base64), (c) =>
          c.charCodeAt(0)
        );
        const fileName = `lims-reports/${order.clinic_id}/${order.id}.pdf`;

        const { error: uploadError } = await supabase.storage
          .from("reports")
          .upload(fileName, pdfBytes, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (uploadError) {
          console.error("lims-receive-result PDF upload error:", uploadError);
        } else {
          const { data: publicUrlData } = supabase.storage
            .from("reports")
            .getPublicUrl(fileName);
          pdfUrl = publicUrlData.publicUrl;
        }
      } catch (err) {
        console.error("lims-receive-result PDF processing error:", err);
      }
    }

    const { error: updateError } = await supabase
      .from("lims_outbound_orders")
      .update({
        status: body.status === "completed" ? "completed" : order.status,
        pdf_url: pdfUrl,
        pdf_received_at: pdfUrl ? new Date().toISOString() : null,
        lims_response: body,
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("lims-receive-result update error:", updateError);
      return json({ error: "Failed to update order" }, 500);
    }

    if (body.results && body.results.length > 0 && order.visit_id) {
      const { data: testsOrdered } = await supabase
        .from("tests_ordered")
        .select("id, testName")
        .eq("visit_id", order.visit_id);

      if (testsOrdered && testsOrdered.length > 0) {
        for (const result of body.results) {
          const matchingTest = testsOrdered.find(
            (t) =>
              t.testName.toLowerCase() === result.test_name.toLowerCase()
          );

          if (matchingTest) {
            await supabase.from("test_results").upsert(
              {
                test_ordered_id: matchingTest.id,
                visit_id: order.visit_id,
                result: result.result,
                normal_range: result.normal_range,
                is_abnormal: result.is_abnormal ?? false,
                result_date: body.completed_at || new Date().toISOString(),
                report_url: pdfUrl,
                notes: result.notes,
              },
              {
                onConflict: "test_ordered_id",
              }
            );

            await supabase
              .from("tests_ordered")
              .update({ status: "completed" })
              .eq("id", matchingTest.id);
          }
        }
      }
    }

    return json({
      success: true,
      order_id: order.id,
      pdf_url: pdfUrl,
      message: "Result received successfully",
    });
  } catch (err) {
    console.error("lims-receive-result unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
