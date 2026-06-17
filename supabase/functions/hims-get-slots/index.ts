import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hims-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DayAvailability {
  isOpen: boolean;
  startTime: string; // "HH:MM" 24h
  endTime: string;   // "HH:MM" 24h
  breakStart?: string;
  breakEnd?: string;
}

// Parse "HH:MM" into { hours, minutes }
function parseTime(t: string): { hours: number; minutes: number } {
  const [h, m] = t.split(":").map(Number);
  return { hours: h, minutes: m };
}

// Format minutes-since-midnight as "HH:MM AM/PM"
function formatSlot(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h < 12 ? "AM" : "PM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${String(displayH).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

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

// Convert stored UTC ISO timestamp → local minutes-since-midnight using clinic timezone offset
function appointmentToLocalMinutes(isoString: string, tzOffsetMinutes: number): number {
  const d = new Date(isoString);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  // Add offset to convert UTC → local, wrap around midnight
  return ((utcMinutes + tzOffsetMinutes) % 1440 + 1440) % 1440;
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
    const { clinicId, doctorId, date } = body; // date: "YYYY-MM-DD"

    if (!clinicId || !doctorId || !date) {
      return new Response(
        JSON.stringify({ error: "clinicId, doctorId, and date are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get doctor availability + verify doctor belongs to clinic
    const { data: doctorProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, doctor_availability")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .eq("is_open_for_consultation", true)
      .eq("is_active", true)
      .single();

    if (profileError || !doctorProfile) {
      return new Response(
        JSON.stringify({ error: "Doctor not found for this clinic" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get clinic settings for fallback working_hours, slot duration and timezone
    const { data: clinicData, error: clinicError } = await supabase
      .from("clinic_settings")
      .select("working_hours, appointment_duration, timezone")
      .eq("id", clinicId)
      .single();

    if (clinicError || !clinicData) {
      return new Response(
        JSON.stringify({ error: "Clinic settings not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Determine availability for the requested day
    const dateObj = new Date(date + "T00:00:00Z");
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayName = dayNames[dateObj.getUTCDay()];

    const availabilitySource = doctorProfile.doctor_availability || clinicData.working_hours || {};
    const dayAvail: DayAvailability | undefined = availabilitySource[dayName];

    if (!dayAvail || !dayAvail.isOpen) {
      return new Response(
        JSON.stringify({ slots: [], message: `Doctor is not available on ${dayName}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const slotDuration: number = clinicData.appointment_duration || 30; // minutes
    const tzOffset = getTimezoneOffsetMinutes(clinicData.timezone || "Asia/Kolkata");

    // 4. Get already-booked appointments for this doctor on this date
    const dayStart = date + "T00:00:00.000Z";
    const dayEnd = date + "T23:59:59.999Z";

    const { data: bookedAppts } = await supabase
      .from("appointments")
      .select("appointment_date, duration")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .gte("appointment_date", dayStart)
      .lte("appointment_date", dayEnd)
      .not("status", "eq", "Cancelled");

    // Build set of booked start-minutes (in local clinic time)
    const bookedStartMinutes = new Set<number>(
      (bookedAppts || []).map((a) => appointmentToLocalMinutes(a.appointment_date, tzOffset))
    );

    // 5. Generate slots
    const start = parseTime(dayAvail.startTime);
    const end = parseTime(dayAvail.endTime);
    const startMin = start.hours * 60 + start.minutes;
    const endMin = end.hours * 60 + end.minutes;

    let breakStartMin = -1;
    let breakEndMin = -1;
    if (dayAvail.breakStart && dayAvail.breakEnd) {
      const bs = parseTime(dayAvail.breakStart);
      const be = parseTime(dayAvail.breakEnd);
      breakStartMin = bs.hours * 60 + bs.minutes;
      breakEndMin = be.hours * 60 + be.minutes;
    }

    const slots: { timeSlot: string; available: boolean }[] = [];

    for (let current = startMin; current + slotDuration <= endMin; current += slotDuration) {
      // Skip break time
      if (breakStartMin >= 0) {
        const slotEnd = current + slotDuration;
        const overlapsBreak =
          (current >= breakStartMin && current < breakEndMin) ||
          (slotEnd > breakStartMin && slotEnd <= breakEndMin) ||
          (current <= breakStartMin && slotEnd >= breakEndMin);
        if (overlapsBreak) continue;
      }

      const available = !bookedStartMinutes.has(current);
      slots.push({ timeSlot: formatSlot(current), available });
    }

    return new Response(JSON.stringify({ doctorName: doctorProfile.name, date, slots }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("hims-get-slots unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
