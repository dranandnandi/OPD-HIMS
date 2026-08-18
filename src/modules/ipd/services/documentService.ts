import { supabase } from '../utils/supabase';
import { generateBarcodeDataUrl } from '../utils/labelGenerator';
import { getClinicInfo, EMPTY_CLINIC_INFO, type ClinicInfo } from './clinicInfoService';
import { nursingService } from './nursingService';
import { treatmentPlanService } from './treatmentPlanService';
import { FREQUENCY_OPTIONS } from './medicationService';
import { DIET_TYPES, MEAL_SLOTS } from './dietService';
import type {
  Admission, IpdBill, Deposit, IpdPayment, MedicationOrder,
  DietOrder, DietChartEntry, IpdOrderItem, TreatmentPlan,
} from '../types/ipd';

export interface DocumentTemplate {
  id: string;
  clinic_id: string;
  doc_type: string;
  name: string;
  html_template: string;
  placeholders: string[];
  page_size: string;
  version: number;
  is_active: boolean;
}

export interface IpdDocument {
  id: string;
  clinic_id: string;
  admission_id: string;
  template_id: string | null;
  doc_type: string;
  document_number: string | null;
  content_html: string;
  status: 'draft' | 'finalized' | 'signed';
  signed_by: string | null;
  signed_at: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Every IPD document type the app can produce. Must stay in sync with the
// doc_type CHECK constraint on ipd_documents / ipd_document_templates.
// ---------------------------------------------------------------------------
export const DOC_TYPES: { key: string; label: string }[] = [
  { key: 'discharge_summary', label: 'Discharge Summary' },
  { key: 'discharge_medication', label: 'Discharge Medication' },
  { key: 'admission_sheet', label: 'Admission Sheet' },
  { key: 'consent', label: 'Consent Form' },
  { key: 'ot_note', label: 'OT Note' },
  { key: 'death_summary', label: 'Death Summary' },
  { key: 'dama_form', label: 'DAMA Form' },
  { key: 'referral_letter', label: 'Referral Letter' },
  { key: 'estimate', label: 'Estimate' },
];

export const docTypeLabel = (docType: string): string =>
  DOC_TYPES.find((d) => d.key === docType)?.label ?? docType.replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// Placeholder catalog — every {{key}} the resolver understands. The Template
// Studio shows these as insert chips; keep labels operator-friendly.
// ---------------------------------------------------------------------------
export const PLACEHOLDER_CATALOG: { key: string; label: string }[] = [
  { key: 'patient.name', label: 'Patient name' },
  { key: 'patient.age', label: 'Age' },
  { key: 'patient.gender', label: 'Gender' },
  { key: 'patient.phone', label: 'Phone' },
  { key: 'patient.blood_group', label: 'Blood group' },
  { key: 'patient.allergies', label: 'Allergies' },
  { key: 'admission.number', label: 'Admission no' },
  { key: 'admission.date', label: 'Admission date' },
  { key: 'admission.bed', label: 'Ward / bed' },
  { key: 'admission.diagnosis', label: 'Diagnosis' },
  { key: 'admission.icd_codes', label: 'ICD-10 codes' },
  { key: 'admission.reason', label: 'Reason for admission' },
  { key: 'admission.los', label: 'Length of stay (days)' },
  { key: 'doctor.name', label: 'Consultant' },
  { key: 'discharge.date', label: 'Discharge date' },
  { key: 'discharge.type', label: 'Discharge type' },
  { key: 'vitals.latest', label: 'Latest vitals' },
  { key: 'medications.discharge', label: 'Discharge medications (table)' },
  { key: 'medications.course', label: 'Medications during stay (list)' },
  { key: 'investigations.list', label: 'Investigations (lab/imaging)' },
  { key: 'reports.list', label: 'Filed reports (pathology/radiology impressions)' },
  { key: 'consultations.list', label: 'Cross consultations & opinions' },
  { key: 'diet.current', label: 'Diet advice (current diet order)' },
  { key: 'notes.course', label: 'Hospital course (treatment plan + round notes)' },
  { key: 'narrative.course', label: 'Hospital course — AI narrative (falls back to round notes)' },
  { key: 'narrative.advice', label: 'Advice & follow-up — AI narrative' },
  { key: 'narrative.condition', label: 'Condition at discharge — AI narrative' },
];

// Bumped whenever DEFAULT_DISCHARGE_TEMPLATE changes; auto-created default
// templates below this version are upgraded in place (Studio edits bump the
// row version past this, so customized templates are never touched).
const DEFAULT_TEMPLATE_VERSION = 4;

// ---------------------------------------------------------------------------
// Default discharge summary template (created per clinic on first use;
// editable in Masters → Document Templates)
// ---------------------------------------------------------------------------
const DEFAULT_DISCHARGE_TEMPLATE = `
<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Discharged:</b> {{discharge.date}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}} · Stay: {{admission.los}} day(s)</td>
  </tr>
</table>

<h3>Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Presenting Complaints / Reason for Admission</h3>
<p>{{admission.reason}}</p>

<h3>Hospital Course</h3>
{{narrative.course}}

<h3>Investigations</h3>
{{investigations.list}}

<h3>Reports</h3>
{{reports.list}}

<h3>Cross Consultations</h3>
{{consultations.list}}

<h3>Vitals at Discharge</h3>
<p>{{vitals.latest}}</p>

<h3>Treatment Given</h3>
{{medications.course}}

<h3>Medications on Discharge</h3>
{{medications.discharge}}

<h3>Diet Advice</h3>
<p>{{diet.current}}</p>

<h3>Advice & Follow-up</h3>
{{narrative.advice}}

<h3>Condition at Discharge</h3>
<p>{{narrative.condition}}</p>

<br/><br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>
`;

// ---------------------------------------------------------------------------
// Skeletons for the non-discharge document types. Each is a heading list — the
// sections a clinician is expected to fill, either by typing or by dictating
// (the voice panel offers exactly these headings as target fields).
// ---------------------------------------------------------------------------
const DOC_TYPE_SECTIONS: Record<string, string[]> = {
  discharge_medication: [
    'Diagnosis', 'Medications on Discharge', 'Diet Advice', 'Advice & Follow-up',
  ],
  admission_sheet: [
    'Presenting Complaints', 'History of Present Illness', 'Past History',
    'Personal & Family History', 'General Examination', 'Systemic Examination',
    'Provisional Diagnosis', 'Plan of Management',
  ],
  consent: [
    'Procedure / Treatment Proposed', 'Explanation Given', 'Risks & Complications Explained',
    'Alternatives Discussed', 'Consent Declaration',
  ],
  ot_note: [
    'Pre-operative Diagnosis', 'Procedure Performed', 'Surgeon & Team', 'Anaesthesia',
    'Operative Findings', 'Procedure in Detail', 'Specimen / Implants',
    'Blood Loss & Fluids', 'Post-operative Instructions',
  ],
  death_summary: [
    'Diagnosis', 'Hospital Course', 'Investigations', 'Treatment Given',
    'Events Leading to Death', 'Cause of Death', 'Time of Death',
  ],
  dama_form: [
    'Diagnosis', 'Condition at Time of Leaving', 'Advice Given',
    'Risks Explained', 'Reason Stated by Patient / Relative', 'Declaration',
  ],
  referral_letter: [
    'Reason for Referral', 'Clinical Summary', 'Investigations',
    'Treatment Given So Far', 'Condition at Referral', 'Advice / Request',
  ],
  estimate: [
    'Provisional Diagnosis', 'Proposed Treatment / Procedure', 'Estimated Length of Stay',
    'Estimated Cost Breakup', 'Notes & Disclaimer',
  ],
};

/** Shared patient/admission header used by every generated skeleton */
const DOC_HEADER_BLOCK = `<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Diagnosis:</b> {{admission.diagnosis}}</td>
  </tr>
</table>`;

/**
 * Build a skeleton template for a document type that has no clinic template
 * yet. Sections the chart can already answer are pre-filled with placeholders;
 * the rest are left as empty paragraphs for typing or dictation.
 */
function buildSkeletonTemplate(docType: string): string {
  const PREFILL: Record<string, string> = {
    'Diagnosis': '<p>{{admission.diagnosis}}</p>',
    'Provisional Diagnosis': '<p>{{admission.diagnosis}}</p>',
    'Pre-operative Diagnosis': '<p>{{admission.diagnosis}}</p>',
    'Presenting Complaints': '<p>{{admission.reason}}</p>',
    'Reason for Referral': '<p>{{admission.reason}}</p>',
    'Medications on Discharge': '{{medications.discharge}}',
    'Treatment Given': '{{medications.course}}',
    'Treatment Given So Far': '{{medications.course}}',
    'Investigations': '{{investigations.list}}',
    'Hospital Course': '{{notes.course}}',
    'Clinical Summary': '{{notes.course}}',
    'Diet Advice': '<p>{{diet.current}}</p>',
    'Advice & Follow-up': '{{narrative.advice}}',
    'Condition at Referral': '<p>{{vitals.latest}}</p>',
    'Condition at Time of Leaving': '<p>{{vitals.latest}}</p>',
  };
  const sections = (DOC_TYPE_SECTIONS[docType] ?? ['Details', 'Advice'])
    .map((heading) => `<h3>${heading}</h3>\n${PREFILL[heading] ?? '<p></p>'}`)
    .join('\n\n');

  return `<h2 style="text-align:center;margin:0 0 4px">${docTypeLabel(docType).toUpperCase()}</h2>
${DOC_HEADER_BLOCK}

${sections}

<br/><br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>
`;
}

/** The built-in template body for a doc type — discharge has a bespoke one */
const defaultTemplateHtml = (docType: string): string =>
  docType === 'discharge_summary' ? DEFAULT_DISCHARGE_TEMPLATE : buildSkeletonTemplate(docType);

/** Name given to auto-created templates — the marker for the auto-upgrade path */
const defaultTemplateName = (docType: string): string => `Default ${docTypeLabel(docType)}`;

// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Left-hand letterhead block shared by every printed sheet: the clinic's own
 * name and contact line from clinic_settings. Blank fields are dropped so a
 * clinic that hasn't filled in its address still prints a clean header.
 */
const letterheadInner = (clinic: ClinicInfo, subtitle: string) => {
  const contact = [
    clinic.address,
    clinic.phone ? `Ph: ${clinic.phone}` : null,
  ].filter(Boolean).join(' · ');

  return `<div>
      ${clinic.name ? `<h1>${esc(clinic.name)}</h1>` : ''}
      ${contact ? `<div class="sub">${esc(contact)}</div>` : ''}
      <div class="sub">${esc(subtitle)}</div>
    </div>`;
};

const FREQ_LABEL = new Map(FREQUENCY_OPTIONS.map((f) => [f.code, f.label.split('—')[0].trim()]));

const fmtRoute = (r: string | null) =>
  !r ? '' : ['iv', 'im', 'sc'].includes(r) ? r.toUpperCase() : r.replace(/_/g, ' ');

const fmtShort = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

/** Active orders at discharge → medications table for the summary */
function buildDischargeMedsHtml(orders: MedicationOrder[]): string {
  const active = orders.filter((o) => o.status === 'active');
  if (active.length === 0) return '<p>None</p>';
  const rows = active
    .map(
      (o) => `<tr>
        <td style="padding:3px 6px;border:1px solid #ccc">${esc(o.medicine_name)}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${esc(o.dose ?? '—')}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${esc(fmtRoute(o.route) || '—')}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${esc(FREQ_LABEL.get(o.frequency_code) ?? o.frequency_code.toUpperCase())}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${esc(o.instructions ?? '')}</td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;font-size:12.5px;border-collapse:collapse">
    <tr>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Medicine</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Dose</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Route</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Frequency</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Instructions</th>
    </tr>${rows}</table>`;
}

/** Every med order of the stay → one-line-per-drug treatment list */
function buildCourseMedsHtml(orders: MedicationOrder[]): string {
  if (orders.length === 0) return '<p>—</p>';
  const items = [...orders]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((o) => {
      const bits = [o.dose, fmtRoute(o.route), FREQ_LABEL.get(o.frequency_code) ?? o.frequency_code.toUpperCase()]
        .filter(Boolean)
        .join(', ');
      const span = `${fmtShort(o.start_at)}${o.end_at ? ` – ${fmtShort(o.end_at)}` : ' onwards'}`;
      const stopped = o.status === 'stopped' ? ', stopped' : '';
      return `<li>${esc(o.medicine_name)}${bits ? ` — ${esc(bits)}` : ''} (${span}${stopped})</li>`;
    })
    .join('');
  return `<ul style="margin:4px 0;padding-left:18px">${items}</ul>`;
}

/** Lab/imaging order items → investigations list with the filed report's
    impression when one exists, else the LIMS result summary, else "awaited" */
async function buildInvestigationsHtml(admissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ipd_order_items')
    .select(`status, result_ref, created_at,
             service:services_master(name, service_type),
             parent_order:ipd_orders(order_datetime),
             reports:ipd_reports(impression, findings, is_abnormal)`)
    .eq('admission_id', admissionId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true });
  if (error) return '<p>[Key investigation findings]</p>';

  const items = (data as any[]).filter((i) =>
    ['lab', 'imaging'].includes(i.service?.service_type)
  );
  if (items.length === 0) return '<p>[Key investigation findings]</p>';

  const rows = items
    .map((i) => {
      const when = fmtShort(i.parent_order?.order_datetime ?? i.created_at);
      const report = (i.reports ?? []).find((r: any) => r.impression || r.findings);
      const result = report
        ? ` — ${esc(report.impression || report.findings)}${report.is_abnormal ? ' <b>(abnormal)</b>' : ''}`
        : typeof i.result_ref?.summary === 'string'
          ? ` — ${esc(i.result_ref.summary)}`
          : i.status === 'resulted' || i.status === 'done'
            ? ''
            : ' — awaited';
      return `<li><b>${when}</b> ${esc(i.service?.name ?? '')}${result}</li>`;
    })
    .join('');
  return `<ul style="margin:4px 0;padding-left:18px">${rows}</ul>`;
}

/** Filed pathology / radiology reports → impression list for the summary */
async function buildReportsHtml(admissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ipd_reports')
    .select('title, report_type, report_date, impression, findings, is_abnormal')
    .eq('admission_id', admissionId)
    .order('report_date', { ascending: true });
  if (error || !data || data.length === 0) return '<p>No reports filed.</p>';

  const rows = (data as any[])
    .map((r) => {
      const body = r.impression || r.findings || 'report on file';
      return `<li><b>${fmtShort(r.report_date)}</b> ${esc(r.title)} <i>(${r.report_type})</i> — ${esc(body)}${
        r.is_abnormal ? ' <b>(abnormal)</b>' : ''
      }</li>`;
    })
    .join('');
  return `<ul style="margin:4px 0;padding-left:18px">${rows}</ul>`;
}

/** Cross consultations with the opinion recorded against each */
async function buildConsultationsHtml(admissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ipd_consultations')
    .select('specialty, external_doctor_name, reason, opinion, status, requested_at, seen_at, doctor:profiles!ipd_consultations_doctor_id_fkey(name)')
    .eq('admission_id', admissionId)
    .neq('status', 'cancelled')
    .order('requested_at', { ascending: true });
  if (error || !data || data.length === 0) return '<p>None.</p>';

  const rows = (data as any[])
    .map((c) => {
      const who = c.doctor?.name
        ? `Dr. ${String(c.doctor.name).replace(/^dr\.?\s*/i, '')}`
        : c.external_doctor_name ?? '';
      const head = [c.specialty, who].filter(Boolean).join(' — ');
      const body = c.opinion ? esc(c.opinion) : 'opinion awaited';
      return `<li><b>${fmtShort(c.seen_at ?? c.requested_at)}</b> ${esc(head || 'Consultation')}: ${esc(
        c.reason ?? ''
      )} → ${body}</li>`;
    })
    .join('');
  return `<ul style="margin:4px 0;padding-left:18px">${rows}</ul>`;
}

/** Running diet order → one-line diet advice for the summary */
async function buildDietHtml(admissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ipd_diet_orders')
    .select('diet_type, route, calories_kcal, protein_g, fluid_restriction_ml, special_instructions, restrictions')
    .eq('admission_id', admissionId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return '[Diet advice on discharge]';

  const d = data as any;
  const bits = [
    `${String(d.diet_type).replace(/_/g, ' ')} diet`,
    d.route && d.route !== 'oral' ? String(d.route).replace(/_/g, ' ') : null,
    d.calories_kcal ? `${d.calories_kcal} kcal/day` : null,
    d.protein_g ? `${d.protein_g} g protein/day` : null,
    d.fluid_restriction_ml ? `fluids ${d.fluid_restriction_ml} ml/day` : null,
    d.special_instructions || null,
    d.restrictions ? `avoid ${d.restrictions}` : null,
  ].filter(Boolean);
  return esc(bits.join(' · '));
}

/** Date-wise treatment plan entries + doctor round/progress notes → the
    chronological hospital-course block */
async function buildCourseNotesHtml(admissionId: string): Promise<string> {
  const [notes, plans] = await Promise.all([
    nursingService.listNotes(admissionId, 100).catch(() => []),
    treatmentPlanService.list(admissionId).catch(() => []),
  ]);

  const course: Array<{ at: string; html: string }> = [
    ...notes
      .filter((n) => n.note_type === 'doctor_round' || n.note_type === 'progress')
      .map((n) => ({ at: n.created_at, html: esc(n.note) })),
    ...plans.map((p) => ({
      at: p.recorded_at,
      html: ([
        ['S', p.subjective], ['O', p.objective], ['A', p.assessment],
        ['Plan', p.plan], ['Advice', p.advice],
      ] as Array<[string, string | null]>)
        .filter(([, v]) => v && v.trim())
        .map(([label, v]) => `<i>${label}:</i> ${esc(v!)}`)
        .join(' · '),
    })).filter((p) => p.html),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (course.length === 0) return '<p>[Describe the clinical course during the stay]</p>';
  return course
    .map(
      (c) =>
        `<p style="margin:3px 0"><b>${new Date(c.at).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })}</b> — ${c.html}</p>`
    )
    .join('');
}

async function buildPlaceholderMap(admission: Admission): Promise<Record<string, string>> {
  const [vitals, medOrders, investigations, courseNotes, reports, consultations, diet] =
    await Promise.all([
      nursingService.listVitals(admission.id, 1).catch(() => []),
      supabase
        .from('ipd_medication_orders')
        .select('*')
        .eq('admission_id', admission.id)
        .then(({ data }) => (data ?? []) as MedicationOrder[]),
      buildInvestigationsHtml(admission.id),
      buildCourseNotesHtml(admission.id),
      buildReportsHtml(admission.id),
      buildConsultationsHtml(admission.id),
      buildDietHtml(admission.id),
    ]);
  const latest = vitals[0];
  const latestVitals = latest
    ? [
        latest.temperature != null ? `Temp ${latest.temperature}°C` : null,
        latest.pulse != null ? `Pulse ${latest.pulse}/min` : null,
        latest.bp_systolic != null ? `BP ${latest.bp_systolic}/${latest.bp_diastolic ?? '?'}` : null,
        latest.spo2 != null ? `SpO₂ ${latest.spo2}%` : null,
        latest.resp_rate != null ? `RR ${latest.resp_rate}/min` : null,
      ]
        .filter(Boolean)
        .join(', ')
    : '—';

  const fmt = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const dischargeAt = admission.discharge_datetime ?? new Date().toISOString();
  const los = Math.max(
    1,
    Math.ceil(
      (new Date(dischargeAt).getTime() - new Date(admission.admission_datetime).getTime()) /
        86_400_000
    )
  );
  const DISCHARGE_TYPE_LABEL: Record<string, string> = {
    routine: 'Routine', dama: 'DAMA (against medical advice)', referred: 'Referred',
    expired: 'Expired', absconded: 'Absconded',
  };

  return {
    'patient.name': admission.patient?.name ?? '',
    'patient.age': String(admission.patient?.age ?? ''),
    'patient.gender': admission.patient?.gender ?? '',
    'patient.phone': admission.patient?.phone ?? '',
    'patient.blood_group': admission.patient?.blood_group ?? '—',
    'patient.allergies': admission.patient?.allergies?.join(', ') || 'None known',
    'admission.number': admission.admission_number,
    'admission.date': fmt(admission.admission_datetime),
    'admission.bed': admission.current_bed
      ? `${admission.current_bed.ward?.name ?? ''} / ${admission.current_bed.bed_number}`
      : '—',
    'admission.diagnosis': admission.provisional_diagnosis ?? '',
    'admission.reason': admission.reason_for_admission ?? '',
    'admission.icd_codes': admission.icd10_codes?.join(', ') || '—',
    'admission.los': String(los),
    'doctor.name': admission.admitting_doctor?.name?.replace(/^dr\.?\s*/i, '') ?? '',
    'discharge.date': fmt(dischargeAt),
    'discharge.type': admission.discharge_type
      ? DISCHARGE_TYPE_LABEL[admission.discharge_type] ?? admission.discharge_type
      : 'Routine',
    'vitals.latest': latestVitals,
    'medications.discharge': buildDischargeMedsHtml(medOrders),
    'medications.course': buildCourseMedsHtml(medOrders),
    'investigations.list': investigations,
    'reports.list': reports,
    'consultations.list': consultations,
    'diet.current': diet,
    'notes.course': courseNotes,
    // Narrative placeholders default to the mechanical output; the AI path
    // (generateDischargeNarrative) overrides these three before resolving.
    'narrative.course': courseNotes,
    'narrative.advice': '<p>[Activity, wound care, warning signs, follow-up date]</p>',
    'narrative.condition': 'Stable',
  };
}

/** True when a template has {{narrative.*}} slots the AI writer can fill */
export const hasNarrativePlaceholders = (html: string): boolean =>
  /\{\{\s*narrative\./.test(html);

function resolvePlaceholders(template: string, map: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => map[key] ?? `{{${key}}}`);
}

/**
 * Ask the AI edge function to write the narrative sections from the assembled
 * chart data, then override the narrative.* placeholders in the map. On any
 * failure the map is returned unchanged, so the mechanical fallback is used.
 */
async function applyAiNarrative(
  map: Record<string, string>
): Promise<Record<string, string>> {
  const context = {
    patient: `${map['patient.name']} (${map['patient.age']}y / ${map['patient.gender']})`,
    allergies: map['patient.allergies'],
    diagnosis: map['admission.diagnosis'],
    icd_codes: map['admission.icd_codes'],
    reason_for_admission: map['admission.reason'],
    admitted_on: map['admission.date'],
    discharged_on: map['discharge.date'],
    discharge_type: map['discharge.type'],
    length_of_stay_days: map['admission.los'],
    vitals_at_discharge: map['vitals.latest'],
    // HTML fragments — the model reads these fine and turns them into prose.
    round_and_plan_notes_html: map['notes.course'],
    investigations_html: map['investigations.list'],
    reports_html: map['reports.list'],
    consultations_html: map['consultations.list'],
    medications_during_stay_html: map['medications.course'],
    medications_on_discharge_html: map['medications.discharge'],
    diet_advice: map['diet.current'],
  };

  const { data, error } = await supabase.functions.invoke('ai-discharge-summary', {
    body: { context },
  });
  if (error) throw new Error(error.message ?? 'AI discharge summary failed');
  if (data?.error) throw new Error(data.error);

  const n = data?.narrative;
  if (!n) return map;
  return {
    ...map,
    'narrative.course': n.hospital_course?.trim() || map['narrative.course'],
    'narrative.advice': n.advice_followup?.trim() || map['narrative.advice'],
    'narrative.condition': n.condition_at_discharge?.trim() || map['narrative.condition'],
  };
}

// ---------------------------------------------------------------------------

export const documentService = {
  async getOrCreateDefaultTemplate(clinicId: string, docType = 'discharge_summary'): Promise<DocumentTemplate> {
    const { data: existing } = await supabase
      .from('ipd_document_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('doc_type', docType)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      // upgrade an untouched auto-created default to the current built-in
      // (Studio saves bump version, so customized templates are skipped)
      if (
        existing.name === defaultTemplateName(docType) &&
        (existing.version ?? 1) < DEFAULT_TEMPLATE_VERSION
      ) {
        const { data: upgraded } = await supabase
          .from('ipd_document_templates')
          .update({
            html_template: defaultTemplateHtml(docType),
            placeholders: PLACEHOLDER_CATALOG.map((p) => p.key),
            version: DEFAULT_TEMPLATE_VERSION,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .maybeSingle();
        if (upgraded) return upgraded as DocumentTemplate;
      }
      return existing as DocumentTemplate;
    }

    const { data, error } = await supabase
      .from('ipd_document_templates')
      .insert({
        clinic_id: clinicId,
        doc_type: docType,
        name: defaultTemplateName(docType),
        html_template: defaultTemplateHtml(docType),
        placeholders: PLACEHOLDER_CATALOG.map((p) => p.key),
        version: DEFAULT_TEMPLATE_VERSION,
      })
      .select()
      .single();
    if (error) throw error;
    return data as DocumentTemplate;
  },

  // --- Template Studio (Masters → Document Templates) ------------------------

  async listTemplates(clinicId: string, activeOnly = false): Promise<DocumentTemplate[]> {
    let q = supabase
      .from('ipd_document_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('doc_type')
      .order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data as DocumentTemplate[];
  },

  async createTemplate(params: {
    clinicId: string;
    docType: string;
    name: string;
    htmlTemplate: string;
    userId?: string;
  }): Promise<DocumentTemplate> {
    const { data, error } = await supabase
      .from('ipd_document_templates')
      .insert({
        clinic_id: params.clinicId,
        doc_type: params.docType,
        name: params.name,
        html_template: params.htmlTemplate,
        placeholders: PLACEHOLDER_CATALOG.map((p) => p.key),
        version: DEFAULT_TEMPLATE_VERSION, // custom from birth — never auto-upgraded
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as DocumentTemplate;
  },

  /** Studio save — bumps version so the auto-upgrade never overwrites edits */
  async updateTemplate(
    id: string,
    patch: { name?: string; htmlTemplate?: string; isActive?: boolean },
    currentVersion: number
  ): Promise<void> {
    const { error } = await supabase
      .from('ipd_document_templates')
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.htmlTemplate !== undefined ? { html_template: patch.htmlTemplate } : {}),
        ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
        version: Math.max(currentVersion + 1, DEFAULT_TEMPLATE_VERSION + 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  },

  async listDocuments(admissionId: string): Promise<IpdDocument[]> {
    const { data, error } = await supabase
      .from('ipd_documents')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as IpdDocument[];
  },

  /** Create a draft document from a template with placeholders resolved */
  async createFromTemplate(params: {
    clinicId: string;
    admission: Admission;
    docType?: string;
    templateId?: string;
    /** links the document to the service posting it was generated for */
    chargePostingId?: string;
    /** when true, AI writes the narrative sections (hospital course, advice, condition) */
    useAi?: boolean;
    userId?: string;
  }): Promise<IpdDocument> {
    let template: DocumentTemplate | null = null;
    if (params.templateId) {
      const { data } = await supabase
        .from('ipd_document_templates')
        .select('*')
        .eq('id', params.templateId)
        .maybeSingle();
      template = data as DocumentTemplate | null;
    }
    if (!template) {
      template = await this.getOrCreateDefaultTemplate(
        params.clinicId,
        params.docType ?? 'discharge_summary'
      );
    }
    const docType = template.doc_type;
    let map = await buildPlaceholderMap(params.admission);
    // Only worth an AI round-trip when the template actually has narrative slots
    if (params.useAi && hasNarrativePlaceholders(template.html_template)) {
      map = await applyAiNarrative(map);
    }
    const content = resolvePlaceholders(template.html_template, map);

    const { data: docNumber } = await supabase.rpc('next_document_number', {
      p_clinic_id: params.clinicId,
      p_doc_type: 'ipd_doc',
    });

    const { data, error } = await supabase
      .from('ipd_documents')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admission.id,
        template_id: template.id,
        doc_type: docType,
        document_number: (docNumber as string) ?? null,
        content_html: content,
        charge_posting_id: params.chargePostingId ?? null,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as IpdDocument;
  },

  async saveContent(documentId: string, contentHtml: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_documents')
      .update({ content_html: contentHtml, updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('status', 'draft');
    if (error) throw error;
  },

  async finalize(documentId: string, userId?: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_documents')
      .update({
        status: 'signed',
        signed_by: userId ?? null,
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);
    if (error) throw error;
  },

  /**
   * Printable self-pay bill: letterhead + patient block, package section,
   * itemized charges grouped by charge code, totals with deposits applied
   * and balance. Uses the same iframe print path as documents.
   */
  async printBill(params: { bill: IpdBill; admission: Admission; clinicId: string }): Promise<void> {
    const clinic = await getClinicInfo(params.clinicId);
    const html = buildBillHtml(params.bill, params.admission, clinic, true);
    printHtml(html);
  },

  /** Client-side payment receipt (A5) — printed when recording a bill payment */
  async printPaymentReceipt(params: {
    payment: IpdPayment;
    bill: IpdBill;
    admission: Admission;
    clinicId: string;
    /** Balance as it stood right after this receipt. Pass it when reprinting an
     *  older receipt — bill.balance_amount already reflects that payment by then. */
    balanceAfter?: number;
  }): Promise<void> {
    const { payment, bill, admission } = params;
    const clinic = await getClinicInfo(params.clinicId);
    const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const isRefund = payment.record_type === 'refund';
    const barcode = generateBarcodeDataUrl(admission.admission_number, { height: 26, fontSize: 8, margin: 2 });
    const balanceAfter = Math.max(
      params.balanceAfter ?? bill.balance_amount - (isRefund ? -payment.amount : payment.amount),
      0,
    );

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${payment.receipt_number}</title>
  <style>
    @page { size: A5 landscape; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .head h1 { margin: 0; font-size: 16px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px;
      color: ${isRefund ? '#b91c1c' : '#1F5065'}; margin: 6px 0 12px; }
    table { width: 100%; font-size: 12px; border-collapse: collapse; }
    td { padding: 4px 6px; }
    td:first-child { color: #555; width: 38%; }
    .amount { font-size: 20px; font-weight: bold; color: ${isRefund ? '#b91c1c' : '#047857'};
      border: 1px dashed #999; border-radius: 6px; padding: 8px 14px; display: inline-block; margin: 10px 0; }
    .sign { margin-top: 24px; display: flex; justify-content: space-between; font-size: 11px; }
  </style>
</head>
<body>
  <div class="head">
    ${letterheadInner(clinic, 'Inpatient Department')}
    <img src="${barcode}" style="height:26px" alt="${admission.admission_number}" />
  </div>
  <div class="title">${isRefund ? 'PAYMENT REFUND RECEIPT' : 'PAYMENT RECEIPT'}</div>
  <table>
    <tr><td>Receipt No</td><td><b>${payment.receipt_number}</b></td></tr>
    <tr><td>Date</td><td>${new Date(payment.received_at).toLocaleString('en-IN')}</td></tr>
    <tr><td>Patient</td><td><b>${admission.patient?.name ?? ''}</b> (${admission.patient?.phone ?? ''})</td></tr>
    <tr><td>Admission No</td><td>${admission.admission_number}</td></tr>
    <tr><td>Against Bill</td><td>${bill.bill_number} (${bill.bill_type.toUpperCase()})</td></tr>
    <tr><td>Mode</td><td style="text-transform:capitalize">${payment.payment_method.replace('_', ' ')}${payment.reference ? ` · ${payment.reference}` : ''}</td></tr>
    <tr><td>Balance after this receipt</td><td><b>${inr(balanceAfter)}</b></td></tr>
  </table>
  <div style="text-align:center">
    <span class="amount">${isRefund ? '− ' : ''}${inr(payment.amount)}</span>
  </div>
  <div class="sign">
    <span>Received from (Patient/Attendant)</span>
    <span>Authorised Signatory</span>
  </div>
</body>
</html>`;
    printHtml(html);
  },

  /** Client-side deposit / refund receipt (A5, browser print) */
  async printDepositReceipt(params: {
    deposit: Deposit;
    admission: Admission;
    clinicId: string;
  }): Promise<void> {
    const { deposit, admission } = params;
    const clinic = await getClinicInfo(params.clinicId);
    const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const isRefund = deposit.entry_type === 'refund';
    const barcode = generateBarcodeDataUrl(admission.admission_number, { height: 26, fontSize: 8, margin: 2 });

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${deposit.receipt_number}</title>
  <style>
    @page { size: A5 landscape; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .head h1 { margin: 0; font-size: 16px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px;
      color: ${isRefund ? '#b91c1c' : '#1F5065'}; margin: 6px 0 12px; }
    table { width: 100%; font-size: 12px; border-collapse: collapse; }
    td { padding: 4px 6px; }
    td:first-child { color: #555; width: 38%; }
    .amount { font-size: 20px; font-weight: bold; color: ${isRefund ? '#b91c1c' : '#047857'};
      border: 1px dashed #999; border-radius: 6px; padding: 8px 14px; display: inline-block; margin: 10px 0; }
    .sign { margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px; }
  </style>
</head>
<body>
  <div class="head">
    ${letterheadInner(clinic, 'Inpatient Department')}
    <img src="${barcode}" style="height:26px" alt="${admission.admission_number}" />
  </div>
  <div class="title">${isRefund ? 'DEPOSIT REFUND RECEIPT' : 'ADVANCE DEPOSIT RECEIPT'}</div>
  <table>
    <tr><td>Receipt No</td><td><b>${deposit.receipt_number}</b></td></tr>
    <tr><td>Date</td><td>${new Date(deposit.received_at).toLocaleString('en-IN')}</td></tr>
    <tr><td>Patient</td><td><b>${admission.patient?.name ?? ''}</b> (${admission.patient?.phone ?? ''})</td></tr>
    <tr><td>Admission No</td><td>${admission.admission_number}</td></tr>
    <tr><td>Consultant</td><td>Dr. ${admission.admitting_doctor?.name?.replace(/^dr\.?\s*/i, '') ?? ''}</td></tr>
    <tr><td>Mode</td><td style="text-transform:capitalize">${(deposit.payment_method ?? '—').replace('_', ' ')}</td></tr>
  </table>
  <div style="text-align:center">
    <span class="amount">${isRefund ? '− ' : ''}${inr(deposit.amount)}</span>
  </div>
  <div class="sign">
    <span>Received ${isRefund ? 'by (Patient/Attendant)' : 'from (Patient/Attendant)'}</span>
    <span>Authorised Signatory</span>
  </div>
</body>
</html>`;
    printHtml(html);
  },

  // --- ward file sheets ------------------------------------------------------

  /** Kitchen / ward copy of the diet order + the day's meal chart */
  async printDietChart(params: {
    admission: Admission;
    clinicId: string;
    order: DietOrder | null;
    entries: DietChartEntry[];
    date: string;
  }): Promise<void> {
    const { order, entries, date } = params;
    const clinic = await getClinicInfo(params.clinicId);
    const dietLabel = order
      ? DIET_TYPES.find((d) => d.key === order.diet_type)?.label ?? order.diet_type
      : 'No diet ordered';

    const orderBox = order
      ? `<table class="kv">
          <tr><td>Diet</td><td><b>${esc(dietLabel)}</b> · ${esc(String(order.route).replace(/_/g, ' '))}</td></tr>
          <tr><td>Targets</td><td>${[
            order.calories_kcal ? `${order.calories_kcal} kcal/day` : null,
            order.protein_g ? `${order.protein_g} g protein/day` : null,
            order.fluid_restriction_ml ? `fluids ${order.fluid_restriction_ml} ml/day` : null,
          ].filter(Boolean).join(' · ') || '—'}</td></tr>
          <tr><td>Instructions</td><td>${esc(order.special_instructions ?? '—')}</td></tr>
          <tr><td>Avoid</td><td>${esc(order.restrictions ?? '—')}</td></tr>
        </table>`
      : '<p style="color:#b45309"><b>No diet order in force — confirm with the treating doctor.</b></p>';

    const meals = MEAL_SLOTS.map((slot) => {
      const e = entries.find((x) => x.meal === slot.key && x.entry_date === date);
      return `<tr>
        <td>${slot.label}<span style="color:#777"> · ${slot.time}</span></td>
        <td>${esc(e?.items ?? '')}</td>
        <td style="text-transform:capitalize">${e?.status ?? ''}</td>
        <td>${e?.intake_percent != null ? `${e.intake_percent}%` : ''}</td>
        <td></td>
      </tr>`;
    }).join('');

    printHtml(chartSheetHtml({
      title: 'DIET CHART',
      subtitle: new Date(date).toLocaleDateString('en-IN', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      }),
      admission: params.admission,
      clinic,
      body: `${orderBox}
        <table class="grid">
          <thead><tr><th>Meal</th><th>Items served</th><th>Status</th><th>Intake</th><th>Nurse sign</th></tr></thead>
          <tbody>${meals}</tbody>
        </table>`,
    }));
  },

  /** Ward file copy of investigations ordered, for the nurses' station */
  async printOrderSheet(params: {
    admission: Admission;
    clinicId: string;
    items: IpdOrderItem[];
  }): Promise<void> {
    const clinic = await getClinicInfo(params.clinicId);
    const rows = params.items
      .filter((i) => i.status !== 'cancelled')
      .map(
        (i) => `<tr>
          <td>${i.parent_order?.order_datetime ? fmtShort(i.parent_order.order_datetime) : ''}</td>
          <td>${esc(i.service?.name ?? '')}${i.quantity > 1 ? ` × ${i.quantity}` : ''}</td>
          <td style="text-transform:uppercase">${i.parent_order?.priority ?? 'routine'}</td>
          <td style="text-transform:capitalize">${i.status.replace('_', ' ')}</td>
          <td>${esc(i.parent_order?.clinical_notes ?? '')}</td>
          <td></td>
        </tr>`
      )
      .join('');

    printHtml(chartSheetHtml({
      title: 'INVESTIGATION ORDER SHEET',
      subtitle: `Printed ${new Date().toLocaleString('en-IN')}`,
      admission: params.admission,
      clinic,
      body: rows
        ? `<table class="grid">
            <thead><tr><th>Date</th><th>Test / procedure</th><th>Priority</th><th>Status</th><th>Instructions</th><th>Collected by</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
        : '<p>No investigations ordered.</p>',
    }));
  },

  /** Date-wise treatment plan sheet for the paper file */
  async printPlanSheet(params: {
    admission: Admission;
    clinicId: string;
    plans: TreatmentPlan[];
  }): Promise<void> {
    const clinic = await getClinicInfo(params.clinicId);
    const ordered = [...params.plans].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    const blocks = ordered
      .map((p) => {
        const lines = ([
          ['Subjective', p.subjective], ['Objective', p.objective], ['Assessment', p.assessment],
          ['Plan', p.plan], ['Advice', p.advice],
        ] as Array<[string, string | null]>)
          .filter(([, v]) => v && v.trim())
          .map(([label, v]) => `<p style="margin:2px 0"><b>${label}:</b> ${esc(v!)}</p>`)
          .join('');
        return `<div class="entry">
          <div class="entry-head">${new Date(p.plan_date).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
          })} · ${new Date(p.recorded_at).toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit',
          })}${p.doctor?.name ? ` · Dr. ${esc(p.doctor.name.replace(/^dr\.?\s*/i, ''))}` : ''}</div>
          ${lines}
        </div>`;
      })
      .join('');

    printHtml(chartSheetHtml({
      title: 'TREATMENT PLAN / PROGRESS SHEET',
      subtitle: `${ordered.length} entr${ordered.length === 1 ? 'y' : 'ies'}`,
      admission: params.admission,
      clinic,
      body: blocks || '<p>No plan documented.</p>',
    }));
  },

  /**
   * Server-side bill PDF via PDF.co (clinic letterhead header/footer from
   * settings). Returns a URL immediately; permanent URL lands on
   * ipd_bills.pdf_url in the background.
   */
  async generateBillPdf(params: {
    bill: IpdBill;
    admission: Admission;
    clinicId: string;
    forceRegenerate?: boolean;
  }): Promise<string> {
    // no local letterhead — the server adds the clinic header/footer images
    const html = buildBillHtml(params.bill, params.admission, EMPTY_CLINIC_INFO, false);
    const { data, error } = await supabase.functions.invoke('generate-ipd-pdf', {
      body: {
        html,
        docType: 'ipd_bill',
        recordId: params.bill.id,
        clinicId: params.clinicId,
        filename: `${params.bill.bill_number}.pdf`,
        forceRegenerate: params.forceRegenerate ?? false,
      },
    });
    if (error) throw new Error(error.message ?? 'PDF generation failed');
    if (data?.error) throw new Error(data.error);
    return data.url as string;
  },

  /**
   * Server-side PDF for a signed document (discharge summary etc.).
   * Permanent URL lands on ipd_documents.pdf_url in the background.
   */
  async generateDocumentPdf(params: {
    doc: IpdDocument;
    admission: Admission;
    clinicId: string;
    forceRegenerate?: boolean;
  }): Promise<string> {
    const barcode = generateBarcodeDataUrl(params.admission.admission_number, {
      height: 30, fontSize: 9, margin: 2,
    });
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px;line-height:1.45;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;color:#555;">
            ${params.doc.document_number ?? ''} · ${params.admission.admission_number}
          </div>
          <img src="${barcode}" style="height:30px" />
        </div>
        ${params.doc.content_html}
      </div>`;
    const { data, error } = await supabase.functions.invoke('generate-ipd-pdf', {
      body: {
        html,
        docType: 'ipd_document',
        recordId: params.doc.id,
        clinicId: params.clinicId,
        filename: `${params.doc.document_number ?? params.doc.doc_type}.pdf`,
        forceRegenerate: params.forceRegenerate ?? false,
      },
    });
    if (error) throw new Error(error.message ?? 'PDF generation failed');
    if (data?.error) throw new Error(data.error);
    return data.url as string;
  },

  /**
   * Print a document with a simple letterhead: clinic name header +
   * admission barcode (Code 128) top-right, footer with doc number.
   * (Server-side letterhead PDF via the LIMS pipeline comes later.)
   */
  async printDocument(params: {
    doc: IpdDocument;
    admission: Admission;
    clinicId: string;
  }): Promise<void> {
    const clinic = await getClinicInfo(params.clinicId);
    const barcode = generateBarcodeDataUrl(params.admission.admission_number, {
      height: 32,
      fontSize: 9,
      margin: 2,
    });

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${params.doc.document_number ?? params.doc.doc_type}</title>
  <style>
    @page { size: A4; margin: 18mm 15mm 20mm 15mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; line-height: 1.45; }
    .letterhead { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 8px; margin-bottom: 14px; }
    .letterhead h1 { margin: 0; font-size: 18px; color: #1F5065; }
    .letterhead .sub { font-size: 11px; color: #555; }
    .barcode img { height: 34px; }
    .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 10px; color: #777;
      border-top: 1px solid #ddd; padding-top: 3px; display: flex; justify-content: space-between; }
    h2 { font-size: 16px; } h3 { font-size: 13.5px; margin: 12px 0 4px; color: #1F5065; }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
  <div class="letterhead">
    ${letterheadInner(clinic, 'Inpatient Department')}
    <div class="barcode"><img src="${barcode}" alt="${params.admission.admission_number}" /></div>
  </div>
  ${params.doc.content_html}
  <div class="footer">
    <span>${params.doc.document_number ?? ''} · ${params.admission.admission_number}</span>
    <span>Generated ${new Date().toLocaleString('en-IN')}</span>
  </div>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-10000px';
    document.body.appendChild(iframe);
    const idoc = iframe.contentWindow?.document;
    if (!idoc) return;
    idoc.open();
    idoc.write(html);
    idoc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 300);
  },
};

// ---------------------------------------------------------------------------
// Shared bill HTML builder.
// letterhead=true  → self-contained page for local browser printing.
// letterhead=false → body only; the server PDF adds the clinic's configured
//                    header/footer images (clinic_settings) around it.
// ---------------------------------------------------------------------------
function buildBillHtml(
  bill: IpdBill,
  admission: Admission,
  clinic: ClinicInfo,
  letterhead: boolean
): string {
  const lines = bill.lines ?? [];
  const packageLines = lines.filter((l) => l.line_type === 'package');
  const chargeLines = lines.filter((l) => l.line_type !== 'package');

  const groups = new Map<string, typeof chargeLines>();
  for (const l of chargeLines) {
    const code = (l.charge_group_path ?? 'OTHER').split('/')[0] || 'OTHER';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(l);
  }

  const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const rows = (ls: typeof chargeLines) =>
    ls.map((l) => `
      <tr>
        <td>${l.description}</td>
        <td class="r">${l.quantity}</td>
        <td class="r">${inr(l.unit_rate)}</td>
        <td class="r">${l.discount > 0 ? inr(l.discount) : '—'}</td>
        <td class="r">${inr(l.net)}</td>
      </tr>`).join('');

  const groupSections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, ls]) => {
      const subtotal = ls.reduce((s, l) => s + Number(l.net), 0);
      return `
        <tr class="group"><td colspan="5">${code}</td></tr>
        ${rows(ls)}
        <tr class="subtotal"><td colspan="4" class="r">${code} subtotal</td><td class="r">${inr(subtotal)}</td></tr>`;
    }).join('');

  const packageSection = packageLines.length
    ? `<tr class="group"><td colspan="5">PACKAGE</td></tr>
       ${rows(packageLines)}
       <tr class="subtotal"><td colspan="4" class="r">Package subtotal</td><td class="r">${inr(packageLines.reduce((s, l) => s + Number(l.net), 0))}</td></tr>
       ${chargeLines.length ? `<tr class="note"><td colspan="5">Items below are outside the package (exclusions / non-covered)</td></tr>` : ''}`
    : '';

  const barcode = generateBarcodeDataUrl(admission.admission_number, { height: 30, fontSize: 9, margin: 2 });

  const styles = `
    ${letterhead ? '@page { size: A4; margin: 15mm 12mm 18mm 12mm; }' : ''}
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .letterhead { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .letterhead h1 { margin: 0; font-size: 17px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .billtitle { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .billtitle b { font-size: 13px; letter-spacing: 1px; color: #1F5065; }
    .meta { display: flex; justify-content: space-between; font-size: 11px;
      background: #f4f6f8; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #666;
      border-bottom: 1px solid #bbb; padding: 4px 6px; }
    td { padding: 3.5px 6px; border-bottom: 1px solid #eee; }
    .r { text-align: right; }
    .group td { background: #eef2f5; font-weight: bold; font-size: 10.5px; letter-spacing: 0.5px;
      color: #1F5065; border-bottom: none; }
    .subtotal td { font-weight: 600; border-bottom: 1px solid #ccc; font-size: 11px; }
    .note td { font-size: 10px; color: #888; font-style: italic; border-bottom: none; }
    .totals { margin-top: 10px; margin-left: auto; width: 55%; font-size: 12px; }
    .totals td { padding: 3px 6px; }
    .totals .grand td { font-size: 14px; font-weight: bold; border-top: 2px solid #1F5065; }
    ${letterhead ? `.footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9.5px; color: #777;
      border-top: 1px solid #ddd; padding-top: 3px; display: flex; justify-content: space-between; }` : ''}
    .sign { margin-top: 34px; display: flex; justify-content: space-between; font-size: 11px; }
  `;

  const headerBlock = letterhead
    ? `<div class="letterhead">
        ${letterheadInner(clinic, `Inpatient Department — ${bill.bill_type.toUpperCase()} BILL`)}
        <img src="${barcode}" alt="${admission.admission_number}" style="height:32px" />
      </div>`
    : `<div class="billtitle">
        <b>${bill.bill_type.toUpperCase()} BILL — INPATIENT DEPARTMENT</b>
        <img src="${barcode}" alt="${admission.admission_number}" style="height:30px" />
      </div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${bill.bill_number}</title>
  <style>${styles}</style>
</head>
<body>
  ${headerBlock}

  <div class="meta">
    <div>
      <b>${admission.patient?.name ?? ''}</b>
      (${admission.patient?.age ?? '—'}y / ${admission.patient?.gender ?? '—'})<br/>
      ${admission.patient?.phone ?? ''}
    </div>
    <div>
      Admission: <b>${admission.admission_number}</b><br/>
      Admitted: ${fmt(admission.admission_datetime)}
    </div>
    <div>
      Bill No: <b>${bill.bill_number}</b><br/>
      Date: ${fmt(bill.bill_datetime)}
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc</th><th class="r">Amount</th></tr>
    </thead>
    <tbody>
      ${packageSection}
      ${groupSections}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Gross Total</td><td class="r">${inr(bill.gross_total)}</td></tr>
    ${bill.discount_total > 0 ? `<tr><td>Discount</td><td class="r">− ${inr(bill.discount_total)}</td></tr>` : ''}
    ${bill.tax_total > 0 ? `<tr><td>Tax</td><td class="r">${inr(bill.tax_total)}</td></tr>` : ''}
    <tr><td><b>Net Payable</b></td><td class="r"><b>${inr(bill.net_total)}</b></td></tr>
    ${bill.deposits_applied > 0 ? `<tr><td>Deposits Applied</td><td class="r">− ${inr(bill.deposits_applied)}</td></tr>` : ''}
    ${bill.paid_amount > 0 ? `<tr><td>Payments Received</td><td class="r">− ${inr(bill.paid_amount)}</td></tr>` : ''}
    <tr class="grand"><td>Balance Due</td><td class="r">${inr(bill.balance_amount)}</td></tr>
  </table>

  <div class="sign">
    <span>Patient / Attendant Signature</span>
    <span>Authorised Signatory</span>
  </div>

  ${letterhead ? `<div class="footer">
    <span>${bill.bill_number} · ${admission.admission_number} · ${bill.status.toUpperCase()}</span>
    <span>Generated ${new Date().toLocaleString('en-IN')}</span>
  </div>` : ''}
</body>
</html>`;
}

/** Shared A4 shell for ward-file sheets (diet chart, order sheet, plan sheet) */
function chartSheetHtml(params: {
  title: string;
  subtitle?: string;
  admission: Admission;
  clinic: ClinicInfo;
  body: string;
}): string {
  const { admission } = params;
  const barcode = generateBarcodeDataUrl(admission.admission_number, { height: 26, fontSize: 8, margin: 2 });
  const bed = admission.current_bed
    ? `${admission.current_bed.ward?.name ?? ''} / ${admission.current_bed.bed_number}`
    : '—';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(params.title)} — ${esc(admission.admission_number)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 8px; }
    .head h1 { margin: 0; font-size: 16px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px;
      color: #1F5065; margin: 4px 0 2px; }
    .subtitle { text-align: center; font-size: 10px; color: #666; margin-bottom: 10px; }
    .patient { display: flex; flex-wrap: wrap; gap: 4px 18px; background: #f4f6f8;
      border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; font-size: 11px; }
    .kv { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .kv td { padding: 3px 6px; vertical-align: top; }
    .kv td:first-child { color: #555; width: 22%; }
    table.grid { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.grid th, table.grid td { border: 1px solid #bbb; padding: 5px 6px; text-align: left;
      vertical-align: top; }
    table.grid th { background: #eef2f5; }
    .entry { border-left: 3px solid #1F5065; padding: 4px 0 4px 8px; margin-bottom: 8px;
      page-break-inside: avoid; }
    .entry-head { font-weight: bold; color: #1F5065; font-size: 11px; margin-bottom: 2px; }
    .sign { margin-top: 26px; display: flex; justify-content: space-between; font-size: 11px; }
  </style>
</head>
<body>
  <div class="head">
    ${letterheadInner(params.clinic, 'Inpatient Department')}
    <img src="${barcode}" style="height:26px" alt="${esc(admission.admission_number)}" />
  </div>
  <div class="title">${esc(params.title)}</div>
  ${params.subtitle ? `<div class="subtitle">${esc(params.subtitle)}</div>` : ''}
  <div class="patient">
    <span><b>${esc(admission.patient?.name ?? '')}</b>${
      admission.patient?.age ? ` · ${admission.patient.age}y` : ''
    }${admission.patient?.gender ? ` / ${esc(admission.patient.gender)}` : ''}</span>
    <span>Adm: ${esc(admission.admission_number)}</span>
    <span>Bed: ${esc(bed)}</span>
    <span>Consultant: Dr. ${esc(admission.admitting_doctor?.name?.replace(/^dr\.?\s*/i, '') ?? '')}</span>
    ${admission.patient?.allergies?.length
      ? `<span style="color:#b91c1c"><b>Allergies:</b> ${esc(admission.patient.allergies.join(', '))}</span>`
      : ''}
  </div>
  ${params.body}
  <div class="sign">
    <span>Nurse in charge</span>
    <span>Doctor's signature</span>
  </div>
</body>
</html>`;
}

function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '-10000px';
  document.body.appendChild(iframe);
  const idoc = iframe.contentWindow?.document;
  if (!idoc) return;
  idoc.open();
  idoc.write(html);
  idoc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 300);
}
