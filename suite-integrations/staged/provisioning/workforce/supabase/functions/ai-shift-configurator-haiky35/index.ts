import { guardEdge } from '../_shared/suite-runtime-guard.ts';
import { supabaseAdmin, readJson, ok, bad, cors, llmJson } from "../_shared/utils.ts";

type Req = {
  organization_id: string;
  instruction_text: string;
  created_by?: string;
  policy_name?: string;
  dry_run?: boolean;
  model_preference?: "haiku" | "gemini";
  selected_entities?: Array<{ type: string; id?: string; name: string; confidence?: number }>;
};

function buildPrompt(input: Req, ctx: any) {
  const schema = {
    policy_name: "string",
    confidence_score: 0.0,
    policy: {
      timezone: "Asia/Kolkata",
      workweek: ["mon", "tue", "wed", "thu", "fri"],
      shift_templates: [
        {
          name: "General",
          start_time: "09:30",
          end_time: "18:30",
          duration_hours: 9,
          break_duration_minutes: 60,
          late_threshold_minutes: 10,
          early_out_threshold_minutes: 15,
        },
      ],
      scope_rules: [
        {
          target_type: "department",
          target_values: ["Sales"],
          shift_name: "General",
          effective_from: "YYYY-MM-DD",
          effective_to: null,
        },
      ],
      exceptions: [],
      hydration_rules: {
        mark_absent_if_no_punch: true,
        auto_holiday_from_calendar: true,
      },
    },
    impact: {
      departments_detected: ["Sales"],
      shifts_detected: ["General"],
      unresolved_entities: [],
    },
  };

  return `
You are an HR attendance policy compiler.
Convert natural-language instruction into strict JSON only.

Rules:
- Use only keys from the schema.
- Use 24-hour HH:MM for time.
- duration_hours must be 8 or 9.
- If unknown entities are mentioned, include them in impact.unresolved_entities.
- Keep confidence_score between 0 and 1.

Context:
${JSON.stringify(ctx)}

Instruction:
${input.instruction_text}

Selected entities already confirmed by user:
${JSON.stringify(input.selected_entities ?? [])}

Output schema example:
${JSON.stringify(schema, null, 2)}
`;
}

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const input = await readJson<Req>(req);
    if (!input?.organization_id || !input?.instruction_text) {
      return bad("organization_id and instruction_text are required", { headers });
    }

    const sb = supabaseAdmin();

    const [{ data: users }, { data: shifts }] = await Promise.all([
      sb.from("users").select("id,name,department").eq("organization_id", input.organization_id).limit(300),
      sb.from("shifts").select("id,name,start_time,end_time,is_active").eq("organization_id", input.organization_id),
    ]);

    const context = {
      departments: Array.from(new Set((users ?? []).map((u: any) => u.department).filter(Boolean))),
      users: (users ?? []).slice(0, 80).map((u: any) => ({ id: u.id, name: u.name, department: u.department })),
      shifts: shifts ?? [],
    };

    const modelPreference = input.model_preference ?? "haiku";
    let parsed: any;

    try {
      if (modelPreference === "haiku") {
        parsed = await llmJson({
          provider: "haiku",
          system: "Return JSON only.",
          userText: buildPrompt(input, context),
        });
      } else {
        parsed = await llmJson({
          provider: "gemini",
          parts: [{ text: buildPrompt(input, context) }],
        });
      }
    } catch {
      parsed = await llmJson({
        provider: modelPreference === "haiku" ? "gemini" : "haiku",
        parts: [{ text: buildPrompt(input, context) }],
        system: "Return JSON only.",
        userText: buildPrompt(input, context),
      });
    }

    const policyName = input.policy_name || parsed.policy_name || "Voice Policy";
    const confidence = Number(parsed?.confidence_score ?? 0.7);
    const instructionJson = parsed?.policy ?? {};

    if (input.dry_run !== false) {
      return ok(
        {
          dry_run: true,
          policy_name: policyName,
          confidence_score: confidence,
          instruction_json: instructionJson,
          impact: parsed?.impact ?? {},
        },
        { headers },
      );
    }

    const { data: latest } = await sb
      .from("attendance_ai_policies")
      .select("policy_version")
      .eq("organization_id", input.organization_id)
      .eq("policy_name", policyName)
      .order("policy_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = Number(latest?.policy_version ?? 0) + 1;

    const { data: created, error: createErr } = await sb
      .from("attendance_ai_policies")
      .insert({
        organization_id: input.organization_id,
        policy_name: policyName,
        policy_version: nextVersion,
        status: "draft",
        instruction_text: input.instruction_text,
        instruction_json: instructionJson,
        model_name: modelPreference === "haiku" ? "claude-haiku-4-5" : "gemini-2.5-flash",
        confidence_score: confidence,
        created_by: input.created_by ?? null,
      })
      .select("*")
      .single();

    if (createErr) return bad(createErr.message, { headers, status: 500 });

    await sb.from("attendance_ai_runs").insert({
      organization_id: input.organization_id,
      policy_id: created.id,
      run_type: "shift_compile",
      status: "completed",
      input_snapshot: {
        instruction_text: input.instruction_text,
        model_preference: modelPreference,
      },
      output_summary: {
        impact: parsed?.impact ?? {},
        confidence_score: confidence,
      },
      completed_at: new Date().toISOString(),
    });

    return ok({ policy: created, impact: parsed?.impact ?? {} }, { headers });
  } catch (e) {
    return bad(String(e), { headers, status: 500 });
  }
}, 'workforce', 'ai-shift-configurator-haiky35'));
