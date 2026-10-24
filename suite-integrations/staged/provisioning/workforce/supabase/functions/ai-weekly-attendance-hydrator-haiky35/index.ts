import { guardEdge } from '../_shared/suite-runtime-guard.ts';
import {
  supabaseAdmin,
  readJson,
  ok,
  bad,
  cors,
  gemini,
} from "../_shared/utils.ts";

type Req = {
  organization_id: string;
  period_start?: string; // YYYY-MM-DD
  period_end?: string; // YYYY-MM-DD
  policy_id?: string;
  mode?: "preview" | "apply";
};

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0-6
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + mondayDiff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: toISODate(start), end: toISODate(end) };
}

function minutesOf(ts?: string | null) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const input = await readJson<Req>(req);
    if (!input.organization_id) return bad("organization_id is required", { headers });

    const sb = supabaseAdmin();
    const wr = defaultWeekRange();
    const periodStart = input.period_start ?? wr.start;
    const periodEnd = input.period_end ?? wr.end;
    const mode = input.mode ?? "preview";

    const { data: activePolicy } = await sb
      .from("attendance_ai_policies")
      .select("*")
      .eq("organization_id", input.organization_id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const policy = input.policy_id
      ? (
        await sb
          .from("attendance_ai_policies")
          .select("*")
          .eq("id", input.policy_id)
          .maybeSingle()
      ).data
      : activePolicy;

    const { data: run, error: runErr } = await sb
      .from("attendance_ai_runs")
      .insert({
        organization_id: input.organization_id,
        policy_id: policy?.id ?? null,
        run_type: "weekly_hydration",
        period_start: periodStart,
        period_end: periodEnd,
        status: "running",
        input_snapshot: {
          mode,
          policy_id: policy?.id ?? null,
          policy_name: policy?.policy_name ?? null,
        },
      })
      .select("*")
      .single();

    if (runErr) return bad(runErr.message, { headers, status: 500 });

    const { data: rows, error: rowsErr } = await sb
      .from("attendance_dashboard_view")
      .select("*")
      .eq("organization_id", input.organization_id)
      .gte("date", periodStart)
      .lte("date", periodEnd);
    if (rowsErr) return bad(rowsErr.message, { headers, status: 500 });

    const holidaySet = new Set<string>(
      (policy?.instruction_json?.holidays ?? []).filter((x: any) => typeof x === "string"),
    );

    // Also load org_holidays from DB
    const { data: orgHolidays } = await sb
      .from("org_holidays")
      .select("date, applies_to_shifts")
      .eq("organization_id", input.organization_id)
      .gte("date", periodStart)
      .lte("date", periodEnd);
    
    // Build a map of holiday dates -> applicable shift IDs (null = all shifts)
    const orgHolidayMap = new Map<string, string[] | null>();
    for (const oh of orgHolidays ?? []) {
      orgHolidayMap.set(oh.date, oh.applies_to_shifts);
    }

    // Load shifts with weekly_off_days for this org
    const { data: shiftsData } = await sb
      .from("shifts")
      .select("id, weekly_off_days")
      .eq("organization_id", input.organization_id)
      .eq("is_active", true);
    
    const shiftWeeklyOffs = new Map<string, string[]>();
    for (const s of shiftsData ?? []) {
      shiftWeeklyOffs.set(s.id, s.weekly_off_days ?? ["sunday"]);
    }

    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    let updated = 0;
    let reviewRequired = 0;
    const decisions: any[] = [];

    for (const r of rows ?? []) {
      const startTime = typeof r.shift_start_time === "string" ? r.shift_start_time.split(":") : null;
      const endTime = typeof r.shift_end_time === "string" ? r.shift_end_time.split(":") : null;

      const shiftStart =
        startTime && startTime.length >= 2
          ? Number(startTime[0]) * 60 + Number(startTime[1])
          : null;
      const shiftEnd =
        endTime && endTime.length >= 2
          ? Number(endTime[0]) * 60 + Number(endTime[1])
          : null;

      const punchInM = minutesOf(r.punch_in_time);
      const punchOutM = minutesOf(r.punch_out_time);
      const lateThreshold = Number(r.shift_late_threshold ?? 15);
      const earlyThreshold = Number(r.shift_early_out_threshold ?? 15);

      const computedIsLate =
        shiftStart != null && punchInM != null ? punchInM > shiftStart + lateThreshold : false;
      const computedIsEarly =
        shiftEnd != null && punchOutM != null ? punchOutM < shiftEnd - earlyThreshold : false;

      const dt = new Date(`${r.date}T00:00:00`);
      const day = dt.getDay();
      
      // Use shift-specific weekly off days instead of hardcoded Sat/Sun
      const rowShiftId = r.shift_id as string | null;
      const weeklyOffs = rowShiftId && shiftWeeklyOffs.has(rowShiftId) 
        ? shiftWeeklyOffs.get(rowShiftId)! 
        : ["sunday"];
      const isWeekend = weeklyOffs.includes(dayNames[day]);
      
      // Check both policy holidays AND org_holidays table
      let isHoliday = holidaySet.has(r.date) || !!r.is_holiday;
      if (!isHoliday && orgHolidayMap.has(r.date)) {
        const applicableShifts = orgHolidayMap.get(r.date);
        // null means all shifts, otherwise check if this shift is included
        isHoliday = applicableShifts === null || !rowShiftId || applicableShifts.includes(rowShiftId);
      }
      
      const isAbsent = !r.punch_in_time;

      // Compute is_half_day based on effective hours
      const shiftDuration = Number(r.shift_duration_hours ?? 8);
      const effectiveHrs = Number(r.effective_hours ?? 0);
      const isHalfDay = r.punch_in_time && effectiveHrs > 0 && effectiveHrs < (shiftDuration / 2);

      const confidence = shiftStart == null || shiftEnd == null ? 0.68 : 0.9;
      const humanReviewRequired = confidence < 0.75;

      if (humanReviewRequired) reviewRequired += 1;

      const decisionPayload = {
        previous: {
          is_late: !!r.is_late,
          is_early_out: !!r.is_early_out,
          is_weekend: !!r.is_weekend,
          is_holiday: !!r.is_holiday,
          is_absent: !!r.is_absent,
          is_half_day: !!r.is_half_day,
        },
        next: {
          is_late: computedIsLate,
          is_early_out: computedIsEarly,
          is_weekend: isWeekend,
          is_holiday: isHoliday,
          is_absent: isAbsent,
          is_half_day: !!isHalfDay,
        },
      };

      decisions.push({
        run_id: run.id,
        user_id: r.user_id,
        attendance_id: r.id,
        decision_type: "attendance_status",
        decision_payload: decisionPayload,
        source_priority: "ai",
        confidence,
        human_review_required: humanReviewRequired,
      });

      if (mode === "apply" && !humanReviewRequired) {
        const { error: updErr } = await sb
          .from("attendance")
          .update({
            is_late: computedIsLate,
            is_early_out: computedIsEarly,
            is_weekend: isWeekend,
            is_holiday: isHoliday,
            is_absent: isAbsent,
            is_half_day: !!isHalfDay,
            ai_source: "ai",
            ai_hydrated_at: new Date().toISOString(),
            ai_hydration_meta: {
              run_id: run.id,
              policy_id: policy?.id ?? null,
              model: "gemini-2.5-flash",
              confidence,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);

        if (!updErr) updated += 1;
      }
    }

    if (decisions.length) {
      const { error: decErr } = await sb.from("attendance_ai_decisions").insert(decisions);
      if (decErr) return bad(decErr.message, { headers, status: 500 });
    }

    let aiSummary = "No additional special overrides detected.";
    try {
      const text = await gemini([
        {
          text:
            "Summarize attendance anomalies for HR in <=5 bullets as JSON {summary:string}. " +
            "Mention if review queue should be prioritized.",
        },
        {
          text: JSON.stringify({
            total_rows: rows?.length ?? 0,
            review_required: reviewRequired,
            updated,
            period_start: periodStart,
            period_end: periodEnd,
          }),
        },
      ]);
      const parsed = JSON.parse(text);
      aiSummary = parsed?.summary || aiSummary;
    } catch {
      // keep default summary
    }

    await sb
      .from("attendance_ai_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_summary: {
          mode,
          total_rows: rows?.length ?? 0,
          updated_rows: updated,
          review_required: reviewRequired,
          ai_summary: aiSummary,
        },
      })
      .eq("id", run.id);

    return ok(
      {
        run_id: run.id,
        mode,
        period_start: periodStart,
        period_end: periodEnd,
        total_rows: rows?.length ?? 0,
        updated_rows: updated,
        review_required: reviewRequired,
        ai_summary: aiSummary,
      },
      { headers },
    );
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-weekly-attendance-hydrator-haiky35'));

