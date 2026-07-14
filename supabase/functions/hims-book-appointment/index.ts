import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hims-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Get clinic timezone offset in minutes from UTC (e.g. IST = +330)
function getTimezoneOffsetMinutes(timezone: string): number {
  try {
    const now = new Date();
    const utcStr = now.toLocaleString("en-US", { timeZone: "UTC" });
    const localStr = now.toLocaleString("en-US", { timeZone: timezone });
    return (new Date(localStr).getTime() - new Date(utcStr).getTime()) / 60000;
  } catch {
    return 330; // fallback: IST UTC+5:30
  }
}

// Accept "HH:MM AM/PM" (12h) OR "HH:MM" (24h) — store as clinic-local time in UTC
function slotToISOTimestamp(date: string, timeSlot: string, tzOffsetMinutes: number): string {
  let hours: number, minutes: number;

  const match12 = timeSlot.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const match24 = timeSlot.match(/^(\d{1,2}):(\d{2})$/);

  if (match12) {
    hours = parseInt(match12[1], 10);
    minutes = parseInt(match12[2], 10);
    const period = match12[3].toUpperCase();
    if (period === "AM" && hours === 12) hours = 0;
    if (period === "PM" && hours !== 12) hours += 12;
  } else if (match24) {
    hours = parseInt(match24[1], 10);
    minutes = parseInt(match24[2], 10);
  } else {
    throw new Error(`Invalid timeSlot format: ${timeSlot}`);
  }

  // Convert local clinic time → UTC by subtracting the offset
  const localMinutes = hours * 60 + minutes;
  const utcMinutes = localMinutes - tzOffsetMinutes;

  const base = new Date(date + "T00:00:00.000Z");
  base.setUTCMinutes(base.getUTCMinutes() + utcMinutes);
  return base.toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const botSecret = Deno.env.get("HIMS_BOT_SECRET");
  if (botSecret && req.headers.get("x-hims-bot-secret") !== botSecret) {
    console.error("[book] REJECTED 401: bad or missing x-hims-bot-secret header", {
      secretHeaderPresent: req.headers.get("x-hims-bot-secret") !== null,
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (e) {
      console.error("[book] REJECTED 400: request body is not valid JSON:", (e as Error).message);
      return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { clinicId, doctorId, date, timeSlot, patientName, patientPhone, reason } = body as {
      clinicId?: string; doctorId?: string; date?: string; timeSlot?: string;
      patientName?: string; patientPhone?: string; reason?: string;
    };

    console.log("[book] request:", { clinicId, doctorId, date, timeSlot, patientName, patientPhone });

    if (!clinicId || !doctorId || !date || !timeSlot || !patientName || !patientPhone) {
      const missing = Object.entries({ clinicId, doctorId, date, timeSlot, patientName, patientPhone })
        .filter(([, v]) => !v)
        .map(([k]) => k);
      console.error("[book] REJECTED 400: missing fields:", missing.join(", "));
      return new Response(
        JSON.stringify({
          error: "clinicId, doctorId, date, timeSlot, patientName, and patientPhone are required",
          missing,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Verify doctor belongs to this clinic and is active
    const { data: doctor, error: doctorError } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .eq("is_open_for_consultation", true)
      .eq("is_active", true)
      .single();

    if (doctorError || !doctor) {
      console.error("[book] REJECTED 404: doctor lookup failed", {
        doctorId,
        clinicId,
        dbError: doctorError?.message || null,
        hint: "doctor must exist in profiles with this clinic_id, is_active=true AND is_open_for_consultation=true",
      });
      return new Response(
        JSON.stringify({ error: "Doctor not found or inactive for this clinic" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Build appointment timestamp — fetch timezone first
    let appointmentTimestamp: string;
    try {
      const { data: tzData } = await supabase
        .from("clinic_settings")
        .select("timezone")
        .eq("id", clinicId)
        .single();
      const tzOffset = getTimezoneOffsetMinutes(tzData?.timezone || "Asia/Kolkata");
      appointmentTimestamp = slotToISOTimestamp(date, timeSlot, tzOffset);
      console.log("[book] resolved slot:", { date, timeSlot, timezone: tzData?.timezone || "Asia/Kolkata (default)", appointmentTimestamp });
    } catch (e) {
      console.error("[book] REJECTED 400: could not parse date/timeSlot", {
        date,
        timeSlot,
        error: (e as Error).message,
        expected: 'timeSlot as "HH:MM AM/PM" or 24h "HH:MM", date as "YYYY-MM-DD"',
      });
      return new Response(
        JSON.stringify({ error: (e as Error).message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Check slot is not already booked
    const { data: conflicting, error: conflictError } = await supabase
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("appointment_date", appointmentTimestamp)
      .not("status", "eq", "Cancelled")
      .limit(1);

    if (conflictError) {
      console.error("[book] conflict check query error (continuing):", conflictError.message);
    }
    if (conflicting && conflicting.length > 0) {
      console.error("[book] REJECTED 409: slot already booked", {
        appointmentTimestamp,
        conflictingAppointmentId: conflicting[0].id,
      });
      return new Response(
        JSON.stringify({ error: "This time slot is already booked" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Find or create the patient by phone within this clinic
    let patientId: string;
    const { data: existingPatient } = await supabase
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone", patientPhone)
      .single();

    if (existingPatient) {
      patientId = existingPatient.id;
      console.log("[book] matched existing patient:", patientId);
    } else {
      const { data: newPatient, error: patientError } = await supabase
        .from("patients")
        .insert({
          name: patientName,
          phone: patientPhone,
          clinic_id: clinicId,
        })
        .select("id")
        .single();

      if (patientError || !newPatient) {
        console.error("[book] REJECTED 500: patient insert failed", {
          patientName,
          patientPhone,
          clinicId,
          dbError: patientError?.message || null,
          dbDetails: patientError?.details || null,
          dbCode: patientError?.code || null,
        });
        return new Response(
          JSON.stringify({ error: "Failed to register patient", detail: patientError?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      patientId = newPatient.id;
      console.log("[book] created new patient:", patientId);
    }

    // 5. Create appointment (default duration from clinic settings)
    const { data: clinicData } = await supabase
      .from("clinic_settings")
      .select("appointment_duration, timezone")
      .eq("id", clinicId)
      .single();

    const duration = clinicData?.appointment_duration || 30;

    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .insert({
        clinic_id: clinicId,
        doctor_id: doctorId,
        patient_id: patientId,
        appointment_date: appointmentTimestamp,
        duration,
        status: "Scheduled",
        appointment_type: "Consultation",
        notes: reason || null,
      })
      .select("id")
      .single();

    if (apptError || !appointment) {
      console.error("[book] REJECTED 500: appointment insert failed", {
        clinicId,
        doctorId,
        patientId,
        appointmentTimestamp,
        dbError: apptError?.message || null,
        dbDetails: apptError?.details || null,
        dbCode: apptError?.code || null,
      });
      return new Response(
        JSON.stringify({ error: "Failed to create appointment", detail: apptError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[book] SUCCESS: appointment created", {
      appointmentId: appointment.id,
      doctorName: doctor.name,
      appointmentTimestamp,
    });

    return new Response(
      JSON.stringify({
        appointmentId: appointment.id,
        doctorName: doctor.name,
        patientName,
        date,
        timeSlot,
        status: "Scheduled",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[book] REJECTED 500: unexpected error:", (err as Error).message, (err as Error).stack);
    return new Response(JSON.stringify({ error: "Internal server error", detail: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
