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

  // Authenticate every non-preflight request with the shared bot secret.
  const botSecret = Deno.env.get("HIMS_BOT_SECRET");
  if (!botSecret) {
    console.error("HIMS_BOT_SECRET is not configured");
    return new Response(JSON.stringify({ error: "Server authentication is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.headers.get("x-hims-bot-secret") !== botSecret) {
    console.error("[get-doctors] REJECTED 401: bad or missing x-hims-bot-secret header", {
      secretHeaderPresent: req.headers.get("x-hims-bot-secret") !== null,
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { clinicId, specialization, searchQuery } = body;

    console.log("[get-doctors] request:", { clinicId, specialization, searchQuery });

    if (!clinicId) {
      console.error("[get-doctors] REJECTED 400: clinicId is missing");
      return new Response(JSON.stringify({ error: "clinicId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build query — anyone with is_open_for_consultation = true, regardless of role
    let query = supabase
      .from("profiles")
      .select("id, name, specialization, qualification, phone, is_open_for_consultation, doctor_availability")
      .eq("clinic_id", clinicId)
      .eq("is_open_for_consultation", true)
      .eq("is_active", true);

    if (specialization) {
      query = query.ilike("specialization", `%${specialization}%`);
    }
    if (searchQuery) {
      query = query.ilike("name", `%${searchQuery}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[get-doctors] REJECTED 400: query error", { clinicId, dbError: error.message, dbCode: error.code });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const doctors = (data || []).map((d) => ({
      id: d.id,
      name: d.name,
      specialization: d.specialization || null,
      qualification: d.qualification || null,
      phone: d.phone || null,
      isOpenForConsultation: d.is_open_for_consultation,
    }));

    console.log("[get-doctors] SUCCESS:", {
      count: doctors.length,
      doctors: doctors.map((d) => ({ id: d.id, name: d.name })),
    });

    return new Response(JSON.stringify({ doctors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[get-doctors] REJECTED 500: unexpected error:", (err as Error).message, (err as Error).stack);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
