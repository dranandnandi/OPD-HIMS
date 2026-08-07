import { supabase } from '../utils/supabase';
import { treatmentPlanService } from './treatmentPlanService';
import { nursingService, VitalsInput } from './nursingService';
import { medicationService } from './medicationService';
import { orderService, OrderCategory } from './orderService';
import { dietService } from './dietService';
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
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const FREQUENCY_CODES = ['od', 'bd', 'tid', 'qid', 'q6h', 'q8h', 'q12h', 'hs', 'stat', 'sos'];

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
      diet: data.diet && data.diet.dietType
        ? {
          dietType: data.diet.dietType as DietType,
          route: (data.diet.route ?? 'oral') as DietRoute,
          caloriesKcal: num(data.diet.caloriesKcal) ?? null,
          proteinG: num(data.diet.proteinG) ?? null,
          fluidRestrictionMl: num(data.diet.fluidRestrictionMl) ?? null,
          instructions: data.diet.instructions ?? null,
          restrictions: data.diet.restrictions ?? null,
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
          input: { ...p, voiceTranscript: data.transcript, doctorId: userId ?? null },
        });
        planId = created.id;
      });
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
      for (const [col, key] of map) {
        const n = num(data.vitals?.[key]);
        if (n !== undefined) v[col] = n;
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

    // 5. Investigations — one order header carrying every resolved line
    const orderLines = selections.investigationServiceIds
      .map((serviceId, idx) => ({ serviceId, inv: data.investigations[idx] }))
      .filter((l): l is { serviceId: string; inv: DictatedInvestigation } => !!l.serviceId && !!l.inv);

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
