import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hims-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const botSecret = Deno.env.get("HIMS_BOT_SECRET");
  if (botSecret && req.headers.get("x-hims-bot-secret") !== botSecret) {
    console.error("[cancel] REJECTED 401: bad or missing x-hims-bot-secret header", {
      secretHeaderPresent: req.headers.get("x-hims-bot-secret") !== null,
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { clinicId, appointmentId } = body;

    console.log("[cancel] request:", { clinicId, appointmentId });

    if (!clinicId || !appointmentId) {
      console.error("[cancel] REJECTED 400: missing fields", { clinicId, appointmentId });
      return new Response(
        JSON.stringify({ error: "clinicId and appointmentId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Verify the appointment exists and belongs to this clinic
    const { data: existing, error: fetchError } = await supabase
      .from("appointments")
      .select("id, status")
      .eq("id", appointmentId)
      .eq("clinic_id", clinicId)
      .single();

    if (fetchError || !existing) {
      console.error("[cancel] REJECTED 404: appointment not found", {
        appointmentId,
        clinicId,
        dbError: fetchError?.message || null,
      });
      return new Response(
        JSON.stringify({ error: "Appointment not found for this clinic" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existing.status === "Cancelled") {
      return new Response(
        JSON.stringify({ appointmentId, status: "Cancelled", message: "Appointment is already cancelled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existing.status === "Completed") {
      console.error("[cancel] REJECTED 409: appointment already Completed", { appointmentId });
      return new Response(
        JSON.stringify({ error: "Cannot cancel a completed appointment" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Cancel it
    const { error: updateError } = await supabase
      .from("appointments")
      .update({ status: "Cancelled", updated_at: new Date().toISOString() })
      .eq("id", appointmentId)
      .eq("clinic_id", clinicId);

    if (updateError) {
      console.error("[cancel] REJECTED 400: update failed", {
        appointmentId,
        clinicId,
        dbError: updateError.message,
        dbCode: updateError.code,
      });
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[cancel] SUCCESS: appointment cancelled", { appointmentId });

    return new Response(
      JSON.stringify({ appointmentId, status: "Cancelled" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[cancel] REJECTED 500: unexpected error:", (err as Error).message, (err as Error).stack);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
