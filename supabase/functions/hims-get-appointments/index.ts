import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hims-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Format ISO timestamp to readable "YYYY-MM-DD HH:MM AM/PM"
function formatAppointmentDate(iso: string): { date: string; timeSlot: string } {
  const d = new Date(iso);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const period = h < 12 ? "AM" : "PM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return {
    date: `${year}-${month}-${day}`,
    timeSlot: `${String(displayH).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const botSecret = Deno.env.get("HIMS_BOT_SECRET");
  if (botSecret && req.headers.get("x-hims-bot-secret") !== botSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { clinicId, patientPhone, date } = body; // date optional: "YYYY-MM-DD"

    if (!clinicId || !patientPhone) {
      return new Response(
        JSON.stringify({ error: "clinicId and patientPhone are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Find patient by phone within the clinic
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("phone", patientPhone)
      .single();

    if (patientError || !patient) {
      return new Response(
        JSON.stringify({ appointments: [], message: "No patient found with this phone number" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Query appointments for this patient
    let query = supabase
      .from("appointments")
      .select(`
        id,
        appointment_date,
        duration,
        status,
        notes,
        appointment_type,
        profiles!appointments_doctor_id_fkey ( name, specialization )
      `)
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id)
      .order("appointment_date", { ascending: true });

    if (date) {
      const dayStart = date + "T00:00:00.000Z";
      const dayEnd = date + "T23:59:59.999Z";
      query = query.gte("appointment_date", dayStart).lte("appointment_date", dayEnd);
    } else {
      // Only upcoming and recent appointments (last 30 days to next 90 days)
      const past = new Date();
      past.setDate(past.getDate() - 30);
      const future = new Date();
      future.setDate(future.getDate() + 90);
      query = query
        .gte("appointment_date", past.toISOString())
        .lte("appointment_date", future.toISOString());
    }

    const { data: appts, error: apptError } = await query;

    if (apptError) {
      console.error("hims-get-appointments error:", apptError);
      return new Response(JSON.stringify({ error: apptError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appointments = (appts || []).map((a) => {
      const { date: apptDate, timeSlot } = formatAppointmentDate(a.appointment_date);
      return {
        appointmentId: a.id,
        doctorName: (a.profiles as any)?.name || null,
        doctorSpecialization: (a.profiles as any)?.specialization || null,
        date: apptDate,
        timeSlot,
        status: a.status,
        appointmentType: a.appointment_type,
        notes: a.notes || null,
      };
    });

    return new Response(
      JSON.stringify({ patientName: patient.name, appointments }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("hims-get-appointments unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
