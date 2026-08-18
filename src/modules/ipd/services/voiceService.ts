import { supabase } from '../utils/supabase';
import { treatmentPlanService } from './treatmentPlanService';
import { nursingService, VitalsInput } from './nursingService';
import { medicationService } from './medicationService';
import { orderService, OrderCategory } from './orderService';
import { dietService } from './dietService';
import { toDietType, toDietRoute } from '../utils/dietCodes';
import type { Admission, DietRoute, DietType, ServiceMaster } from '../types/ipd';

// ============================================================================
// Ward-round dictation: one recording → structured chart entries, reviewed by
// the user, then written to the right table. Same model/edge-function pattern
// as the OPD visit recorder (transcribe-medical-audio).
// ============================================================================

export interface DictatedPlan {
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  advice: string | null;
}

export interface DictatedMedication {
  medicine: string;
  dose: string | null;
  route: string | null;
  frequency: string;
  days: number | null;
  instructions: string | null;
  action: 'start' | 'stop' | 'continue';
}

export interface DictatedInvestigation {
  testName: string;
  category: OrderCategory;
  urgency: 'routine' | 'urgent' | 'stat';
  instructions: string | null;
}

export interface DictatedConsultation {
  specialty: string;
  reason: string;
  urgency: 'routine' | 'urgent' | 'stat';
}

export interface DictatedDiet {
  dietType: DietType;
  route: DietRoute;
  caloriesKcal: number | null;
  proteinG: number | null;
  fluidRestrictionMl: number | null;
  instructions: string | null;
  restrictions: string | null;
}

export interface DictatedTask {
  task: string;
  recurrence: string | null;
  dueInHours: number | null;
}

export interface DictatedIO {
  ioType: 'intake' | 'output';
  route: string;
  volumeMl: number;
}

export interface DictatedFinding {
  label: string;
  value: string;
}

export interface DictationResult {
  transcript: string;
  noteKind: 'round' | 'nursing' | 'handover' | 'procedure';
  treatmentPlan: DictatedPlan;
  nursingNote: string | null;
  vitals: Record<string, number | string | null>;
  medications: DictatedMedication[];
  investigations: DictatedInvestigation[];
  consultations: DictatedConsultation[];
  diet: DictatedDiet | null;
  nursingTasks: DictatedTask[];
  intakeOutput: DictatedIO[];
  /** Clinically relevant prose that fits none of the structured sections. */
  additionalNotes: string | null;
  /** Labelled leftovers — consent, counselling, code status, and the like. */
  unmappedFindings: DictatedFinding[];
  /** Lines the model returned but that could not be filed (e.g. I/O with no volume). */
  droppedLines: string[];
  privacyRedactions: number;
}

export interface AdmissionVoiceContext {
  patientName?: string;
  age?: number | null;
  gender?: string | null;
  wardBed?: string;
  admittedOn?: string;
  dayOfStay?: number;
  doctorName?: string;
  diagnosis?: string;
  activeProblems?: string[];
  allergies?: string[];
  activeMedications?: string[];
  currentDiet?: string;
  lastPlan?: string;
}

/** What the user ticked in the review panel before applying */
export interface DictationSelections {
  plan: boolean;
  nursingNote: boolean;
  vitals: boolean;
  medications: boolean[];
  /** service resolved for each investigation (null = skip that line) */
  investigationServiceIds: Array<string | null>;
  consultations: boolean[];
  diet: boolean;
  tasks: boolean[];
  io: boolean[];
  /** file the leftovers + raw transcript so nothing dictated is lost */
  additionalNotes: boolean;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Physiological ranges enforced by the ipd_vitals CHECK constraints. A single
 * out-of-range field used to reject the whole row (losing every other vital in
 * the same dictation), so anything outside its range is dropped here instead.
 */
const VITAL_RANGES: Partial<Record<keyof VitalsInput, [number, number]>> = {
  temperature: [30, 45],
  pulse: [0, 300],
  resp_rate: [0, 100],
  bp_systolic: [0, 350],
  bp_diastolic: [0, 250],
  spo2: [0, 100],
  pain_score: [0, 10],
};

/**
 * The model is asked for Celsius but sometimes echoes what was spoken, and
 * Fahrenheit is what most Indian wards say out loud ("temp 99.4"). Anything
 * above the human Celsius range but inside the Fahrenheit one is converted.
 */
const normaliseTemperature = (t: number): number | undefined => {
  const c = t > 45 && t <= 115 ? ((t - 32) * 5) / 9 : t;
  const rounded = Math.round(c * 10) / 10;
  return rounded >= 30 && rounded <= 45 ? rounded : undefined;
};

const FREQUENCY_CODES = ['od', 'bd', 'tid', 'qid', 'q6h', 'q8h', 'q12h', 'hs', 'stat', 'sos'];

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.toLowerCase() !== 'null' ? s : null;
};

export const voiceService = {
  /** Build the context block the model gets, from the live chart */
  async buildContext(admission: Admission): Promise<AdmissionVoiceContext> {
    const [meds, diet, lastPlan] = await Promise.all([
      medicationService.listOrders(admission.id).catch(() => []),
      dietService.activeOrder(admission.id).catch(() => null),
      treatmentPlanService.latest(admission.id).catch(() => null),
    ]);

    const admittedOn = new Date(admission.admission_datetime);
    const dayOfStay = Math.max(
      1,
      Math.floor((Date.now() - admittedOn.getTime()) / (24 * 60 * 60 * 1000)) + 1
    );

    return {
      patientName: admission.patient?.name,
      age: admission.patient?.age ?? null,
      gender: admission.patient?.gender ?? null,
      wardBed: admission.current_bed
        ? `${admission.current_bed.ward?.name ?? ''} / ${admission.current_bed.bed_number}`
        : undefined,
      admittedOn: admittedOn.toLocaleString('en-IN'),
      dayOfStay,
      doctorName: admission.admitting_doctor?.name ?? undefined,
      diagnosis: admission.provisional_diagnosis ?? undefined,
      activeProblems: admission.icd10_codes?.length ? admission.icd10_codes : undefined,
      allergies: admission.patient?.allergies ?? undefined,
      activeMedications: meds
        .filter((m) => m.status === 'active')
        .map((m) => `${m.medicine_name}${m.dose ? ` ${m.dose}` : ''} ${m.frequency_code}${m.route ? ` ${m.route}` : ''}`),
      currentDiet: diet ? `${diet.diet_type} (${diet.route})` : undefined,
      lastPlan: lastPlan?.plan ?? undefined,
    };
  },

  /** Send audio (or typed text) to the IPD dictation function */
  async dictate(params: {
    audioBase64?: string;
    mimeType?: string;
    textInput?: string;
    context: AdmissionVoiceContext;
  }): Promise<DictationResult> {
    const { data, error } = await supabase.functions.invoke('transcribe-ipd-audio', {
      body: {
        audioBase64: params.audioBase64,
        mimeType: params.mimeType ?? 'audio/webm',
        textInput: params.textInput,
        admissionContext: params.context,
      },
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Dictation failed');

    // Anything the model returned but that cannot be filed is reported rather
    // than filtered away in silence.
    const droppedLines: string[] = [];
    for (const io of (data.intakeOutput ?? []) as Array<Record<string, unknown>>) {
      if (!(num(io.volumeMl) ?? 0)) {
        droppedLines.push(`Intake/output "${io.ioType ?? '?'} ${io.route ?? ''}" — no volume dictated`);
      }
    }
    for (const m of (data.medications ?? []) as Array<Record<string, unknown>>) {
      if (!String(m.medicine ?? '').trim()) droppedLines.push('A medicine line had no drug name');
    }

    const rawDiet = data.diet as Record<string, unknown> | null;
    const dietType = rawDiet ? toDietType(rawDiet.dietType) : null;

    return {
      transcript: data.transcript ?? '',
      noteKind: data.noteKind ?? 'round',
      treatmentPlan: {
        subjective: data.treatmentPlan?.subjective ?? null,
        objective: data.treatmentPlan?.objective ?? null,
        assessment: data.treatmentPlan?.assessment ?? null,
        plan: data.treatmentPlan?.plan ?? null,
        advice: data.treatmentPlan?.advice ?? null,
      },
      nursingNote: data.nursingNote ?? null,
      vitals: data.vitals ?? {},
      medications: (data.medications ?? []).map((m: Record<string, unknown>) => ({
        medicine: String(m.medicine ?? '').trim(),
        dose: (m.dose as string) ?? null,
        route: (m.route as string) ?? null,
        frequency: FREQUENCY_CODES.includes(String(m.frequency)) ? String(m.frequency) : 'od',
        days: num(m.days) ?? 3,
        instructions: (m.instructions as string) ?? null,
        action: (['start', 'stop', 'continue'].includes(String(m.action)) ? m.action : 'start') as
          DictatedMedication['action'],
      })).filter((m: DictatedMedication) => m.medicine),
      investigations: (data.investigations ?? []).map((i: Record<string, unknown>) => ({
        testName: String(i.testName ?? '').trim(),
        category: (['pathology', 'radiology', 'procedure'].includes(String(i.category))
          ? i.category
          : 'other') as OrderCategory,
        urgency: (['routine', 'urgent', 'stat'].includes(String(i.urgency)) ? i.urgency : 'routine') as
          DictatedInvestigation['urgency'],
        instructions: (i.instructions as string) ?? null,
      })).filter((i: DictatedInvestigation) => i.testName),
      consultations: (data.consultations ?? []).map((c: Record<string, unknown>) => ({
        specialty: String(c.specialty ?? '').trim(),
        reason: String(c.reason ?? '').trim(),
        urgency: (['routine', 'urgent', 'stat'].includes(String(c.urgency)) ? c.urgency : 'routine') as
          DictatedConsultation['urgency'],
      })).filter((c: DictatedConsultation) => c.specialty || c.reason),
      diet: rawDiet && dietType
        ? {
          dietType: dietType.type,
          route: toDietRoute(rawDiet.route),
          caloriesKcal: num(rawDiet.caloriesKcal) ?? null,
          proteinG: num(rawDiet.proteinG) ?? null,
          fluidRestrictionMl: num(rawDiet.fluidRestrictionMl) ?? null,
          // An unrecognised diet code becomes "other" — keep what was actually
          // said in the instructions so the intent survives.
          instructions: [text(rawDiet.instructions), dietType.spoken ? `Diet as dictated: ${dietType.spoken}` : null]
            .filter(Boolean).join(' | ') || null,
          restrictions: text(rawDiet.restrictions),
        }
        : null,
      nursingTasks: (data.nursingTasks ?? []).map((t: Record<string, unknown>) => ({
        task: String(t.task ?? '').trim(),
        recurrence: (t.recurrence as string) ?? null,
        dueInHours: num(t.dueInHours) ?? null,
      })).filter((t: DictatedTask) => t.task),
      intakeOutput: (data.intakeOutput ?? []).map((io: Record<string, unknown>) => ({
        ioType: (io.ioType === 'output' ? 'output' : 'intake') as DictatedIO['ioType'],
        route: String(io.route ?? 'oral'),
        volumeMl: num(io.volumeMl) ?? 0,
      })).filter((io: DictatedIO) => io.volumeMl > 0),
      additionalNotes: text(data.additionalNotes),
      unmappedFindings: ((data.unmappedFindings ?? []) as Array<Record<string, unknown>>)
        .map((f) => ({ label: text(f.label) ?? 'Additional finding', value: text(f.value) ?? '' }))
        .filter((f: DictatedFinding) => f.value),
      droppedLines,
      privacyRedactions: data.privacyRedactions ?? 0,
    };
  },

  /** Best-guess catalog match for each dictated test, for the review panel */
  async matchInvestigations(
    clinicId: string,
    investigations: DictatedInvestigation[]
  ): Promise<Array<{ suggestion: ServiceMaster | null; options: ServiceMaster[] }>> {
    return Promise.all(
      investigations.map(async (inv) => {
        try {
          const options = await orderService.listOrderableServices(clinicId, inv.category, inv.testName);
          const fallback = options.length
            ? options
            : await orderService.listOrderableServices(clinicId, 'all', inv.testName);
          return { suggestion: fallback[0] ?? null, options: fallback.slice(0, 15) };
        } catch {
          return { suggestion: null, options: [] };
        }
      })
    );
  },

  /**
   * Write the reviewed dictation into the chart. The treatment-plan entry is
   * created first so every order raised from the same dictation can point back
   * at it. Each section is independent — a failure in one is reported but does
   * not roll back the rest (the user can re-apply just that part).
   */
  async applyDictation(params: {
    clinicId: string;
    admission: Admission;
    userId?: string;
    data: DictationResult;
    selections: DictationSelections;
  }): Promise<{ applied: string[]; failed: string[] }> {
    const { clinicId, admission, userId, data, selections } = params;
    const applied: string[] = [];
    const failed: string[] = [];
    let planId: string | null = null;

    const run = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        applied.push(label);
      } catch (e) {
        console.error(`[IPD] dictation apply failed: ${label}`, e);
        failed.push(`${label} (${(e as Error).message})`);
      }
    };

    // Everything the model could not file into a structured section, plus any
    // line that had to be dropped. Kept together so a dictation is never lost.
    const leftoverText = [
      data.additionalNotes,
      ...data.unmappedFindings.map((f) => `${f.label}: ${f.value}`),
      ...data.droppedLines.map((l) => `Not filed — ${l}`),
    ].filter((v): v is string => !!v && !!v.trim()).join('\n') || null;

    const keepLeftovers = selections.additionalNotes && !!(leftoverText || data.transcript.trim());

    // 1. Treatment plan entry — the anchor for everything else
    const p = data.treatmentPlan;
    const planHasContent = [p.subjective, p.objective, p.assessment, p.plan, p.advice].some(
      (v) => v && v.trim()
    );
    if (selections.plan && planHasContent) {
      await run('Treatment plan', async () => {
        const created = await treatmentPlanService.create({
          clinicId,
          admissionId: admission.id,
          userId,
          input: {
            ...p,
            advice: keepLeftovers && leftoverText
              ? [p.advice, `Also noted:\n${leftoverText}`].filter(Boolean).join('\n')
              : p.advice,
            voiceTranscript: data.transcript,
            doctorId: userId ?? null,
          },
        });
        planId = created.id;
      });
    } else if (keepLeftovers) {
      // No plan entry was created, so the leftovers and the raw transcript would
      // have had nowhere to live — file them as a note instead of losing them.
      await run('Other dictated notes', () =>
        nursingService.addNote({
          clinicId,
          admissionId: admission.id,
          noteType: data.noteKind === 'handover' ? 'handover' : 'nursing',
          note: [leftoverText, data.transcript.trim() ? `Dictation transcript:\n${data.transcript.trim()}` : null]
            .filter(Boolean)
            .join('\n\n'),
          userId,
        })
      );
    }

    // 2. Nursing note — separate stream from the doctor's plan
    if (selections.nursingNote && data.nursingNote?.trim()) {
      await run('Nursing note', () =>
        nursingService.addNote({
          clinicId,
          admissionId: admission.id,
          noteType: data.noteKind === 'handover' ? 'handover' : 'nursing',
          note: data.nursingNote!.trim(),
          userId,
        })
      );
    }

    // 3. Vitals
    if (selections.vitals) {
      const v: VitalsInput = {};
      const map: Array<[keyof VitalsInput, string]> = [
        ['temperature', 'temperature'],
        ['pulse', 'pulse'],
        ['resp_rate', 'respRate'],
        ['bp_systolic', 'bpSystolic'],
        ['bp_diastolic', 'bpDiastolic'],
        ['spo2', 'spo2'],
        ['pain_score', 'painScore'],
        ['blood_sugar', 'bloodSugar'],
        ['weight_kg', 'weightKg'],
      ];
      const rejected: string[] = [];
      for (const [col, key] of map) {
        const n = num(data.vitals?.[key]);
        if (n === undefined) continue;

        if (col === 'temperature') {
          const t = normaliseTemperature(n);
          if (t === undefined) {
            rejected.push(`temperature ${n}`);
            continue;
          }
          v.temperature = t;
          continue;
        }

        const range = VITAL_RANGES[col];
        if (range && (n < range[0] || n > range[1])) {
          rejected.push(`${key} ${n}`);
          continue;
        }
        v[col] = n;
      }

      // Implausible readings are never worth blocking the plausible ones — file
      // them as a note so the number the doctor actually said is still on record.
      if (rejected.length > 0) {
        await run('Out-of-range vitals note', () =>
          nursingService.addNote({
            clinicId,
            admissionId: admission.id,
            noteType: 'nursing',
            note: `Dictated vitals outside the recordable range, not saved to the vitals chart: ${rejected.join(', ')}`,
            userId,
          })
        );
      }

      if (Object.keys(v).length > 0) {
        await run('Vitals', () =>
          nursingService.recordVitals({ clinicId, admissionId: admission.id, vitals: v, userId })
        );
      }
    }

    // 4. Medications — 'start' creates an order; 'stop' stops the running one
    for (let i = 0; i < data.medications.length; i++) {
      if (!selections.medications[i]) continue;
      const m = data.medications[i];
      if (m.action === 'continue') continue;

      if (m.action === 'stop') {
        await run(`Stop ${m.medicine}`, async () => {
          const orders = await medicationService.listOrders(admission.id);
          const match = orders.find(
            (o) => o.status === 'active' && o.medicine_name.toLowerCase().includes(m.medicine.toLowerCase())
          );
          if (!match) throw new Error('no matching active order');
          await medicationService.stopOrder(match.id, 'Stopped on ward round');
        });
        continue;
      }

      await run(`Medicine ${m.medicine}`, async () => {
        const matches = await medicationService.searchMedicines(clinicId, m.medicine);
        const formulary = matches.find(
          (x) => x.name.toLowerCase() === m.medicine.toLowerCase()
        ) ?? matches[0];
        await medicationService.createOrder({
          clinicId,
          admissionId: admission.id,
          medicineId: formulary?.id,
          medicineName: formulary?.name ?? m.medicine,
          dose: m.dose ?? undefined,
          route: m.route ?? undefined,
          frequencyCode: m.frequency,
          days: m.frequency === 'stat' ? 1 : m.days ?? 3,
          instructions: m.instructions ?? undefined,
          treatmentPlanId: planId,
          userId,
        });
      });
    }

    // 5. Investigations — one order header carrying every resolved line.
    // The model often names the same test twice ("send a CBC… and repeat the
    // CBC in the morning"), and two lines resolving to one catalog service
    // would place — and charge — the test twice.
    const seenServices = new Set<string>();
    const orderLines = selections.investigationServiceIds
      .map((serviceId, idx) => ({ serviceId, inv: data.investigations[idx] }))
      .filter((l): l is { serviceId: string; inv: DictatedInvestigation } => !!l.serviceId && !!l.inv)
      .filter((l) => {
        if (seenServices.has(l.serviceId)) return false;
        seenServices.add(l.serviceId);
        return true;
      });

    if (orderLines.length > 0) {
      const urgency = orderLines.some((l) => l.inv.urgency === 'stat')
        ? 'stat'
        : orderLines.some((l) => l.inv.urgency === 'urgent')
          ? 'urgent'
          : 'routine';
      await run(`${orderLines.length} investigation(s)`, () => {
        if (!userId) throw new Error('signed-in doctor required to place orders');
        return orderService.placeOrder({
          clinicId,
          admissionId: admission.id,
          orderedBy: userId,
          priority: urgency,
          clinicalNotes: orderLines
            .map((l) => `${l.inv.testName}${l.inv.instructions ? ` — ${l.inv.instructions}` : ''}`)
            .join('; '),
          treatmentPlanId: planId,
          tariffPlanId: admission.tariff_plan_id,
          bedTypeId: admission.current_bed?.bed_type_id ?? null,
          lines: orderLines.map((l) => ({ serviceId: l.serviceId })),
        });
      });
    }

    // 6. Cross consultations
    for (let i = 0; i < data.consultations.length; i++) {
      if (!selections.consultations[i]) continue;
      const c = data.consultations[i];
      await run(`${c.specialty} consultation`, () =>
        treatmentPlanService.requestConsultation({
          clinicId,
          admissionId: admission.id,
          treatmentPlanId: planId,
          specialty: c.specialty,
          reason: c.reason || `Opinion requested — ${c.specialty}`,
          urgency: c.urgency,
          userId,
        })
      );
    }

    // 7. Diet
    if (selections.diet && data.diet) {
      const d = data.diet;
      await run('Diet order', () =>
        dietService.setOrder({
          clinicId,
          admissionId: admission.id,
          userId,
          input: {
            dietType: d.dietType,
            route: d.route,
            caloriesKcal: d.caloriesKcal,
            proteinG: d.proteinG,
            fluidRestrictionMl: d.fluidRestrictionMl,
            specialInstructions: d.instructions,
            restrictions: d.restrictions,
            treatmentPlanId: planId,
          },
        })
      );
    }

    // 8. Nursing tasks
    for (let i = 0; i < data.nursingTasks.length; i++) {
      if (!selections.tasks[i]) continue;
      const t = data.nursingTasks[i];
      const dueAt = t.dueInHours != null
        ? new Date(Date.now() + t.dueInHours * 60 * 60 * 1000).toISOString()
        : undefined;
      await run(`Task: ${t.task.slice(0, 30)}`, () =>
        nursingService.addTask({
          clinicId,
          admissionId: admission.id,
          task: t.task,
          dueAt,
          recurrence: t.recurrence ?? undefined,
          userId,
        })
      );
    }

    // 9. Intake / output
    for (let i = 0; i < data.intakeOutput.length; i++) {
      if (!selections.io[i]) continue;
      const io = data.intakeOutput[i];
      await run(`${io.ioType} ${io.volumeMl} ml`, () =>
        nursingService.recordIO({
          clinicId,
          admissionId: admission.id,
          ioType: io.ioType,
          route: io.route,
          volumeMl: io.volumeMl,
          userId,
        })
      );
    }

    return { applied, failed };
  },
};
