import { supabase } from '../utils/supabase';
import { generateBarcodeDataUrl } from '../utils/labelGenerator';
import { getClinicInfo, EMPTY_CLINIC_INFO, type ClinicInfo } from './clinicInfoService';
import { nursingService } from './nursingService';
import { treatmentPlanService } from './treatmentPlanService';
import { FREQUENCY_OPTIONS } from './medicationService';
import { DIET_TYPES, MEAL_SLOTS } from './dietService';
import type { GeneratedPdf } from '../../../services/pdfService';
import type {
  Admission, IpdBill, Deposit, IpdPayment, MedicationOrder,
  DietOrder, DietChartEntry, IpdOrderItem, TreatmentPlan, Vitals,
  IntakeOutput, NursingNote,
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
  /** null on a pre-admission estimate — the patient is not admitted yet */
  admission_id: string | null;
  patient_id?: string | null;
  /** ComposeSubject the document was quoted against (pre-admission only) */
  subject_context?: unknown;
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
  { key: 'initial_assessment', label: 'Initial Doctor Assessment' },
  { key: 'admission_sheet', label: 'Admission Sheet' },
  { key: 'case_sheet', label: 'IPD Case Sheet (Orders)' },
  { key: 'nursing_chart', label: 'Nursing Sheet' },
  { key: 'ot_note', label: 'OT Note (Report of Surgery)' },
  { key: 'discharge_summary', label: 'Discharge Summary' },
  { key: 'discharge_medication', label: 'Discharge Medication' },
  { key: 'consent', label: 'Consent Form' },
  { key: 'death_summary', label: 'Death Summary' },
  { key: 'dama_form', label: 'DAMA Form' },
  { key: 'referral_letter', label: 'Referral Letter' },
  { key: 'estimate', label: 'Estimate' },
];

export const docTypeLabel = (docType: string): string =>
  DOC_TYPES.find((d) => d.key === docType)?.label ?? docType.replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// Who may WRITE each document type. Everyone with 'ipd_documents' reads and
// prints every type; authoring (create / edit / sign / delete) is gated on the
// type's required permission:
//
//   ipd_documents           front-desk & ward paperwork — consent, admission
//                           sheet, DAMA, estimate
//   ipd_documents_nursing   the nursing sheet
//   ipd_documents_clinical  the treating doctor's documents — assessment, case
//                           sheet, OT note, discharge/death summary, referral
//
// A clinic can move any type between the three from Masters → Document
// Templates; the override lives in ipd_doc_type_access. RLS resolves the same
// map (public.ipd_can_author_doc), so this is not the only lock — keep in sync
// with public.ipd_default_doc_permission() in
// supabase/migrations/20260829000000_ipd_doc_types_and_authorship.sql.
// ---------------------------------------------------------------------------
export type DocAuthorPermission =
  | 'ipd_documents'
  | 'ipd_documents_nursing'
  | 'ipd_documents_clinical';

export const DOC_AUTHOR_LEVELS: { key: DocAuthorPermission; label: string }[] = [
  { key: 'ipd_documents', label: 'Any documents user (front desk / ward)' },
  { key: 'ipd_documents_nursing', label: 'Nursing staff & doctors' },
  { key: 'ipd_documents_clinical', label: 'Treating doctor only' },
];

export const DEFAULT_DOC_TYPE_PERMISSION: Record<string, DocAuthorPermission> = {
  initial_assessment: 'ipd_documents_clinical',
  admission_sheet: 'ipd_documents',
  case_sheet: 'ipd_documents_clinical',
  nursing_chart: 'ipd_documents_nursing',
  ot_note: 'ipd_documents_clinical',
  discharge_summary: 'ipd_documents_clinical',
  discharge_medication: 'ipd_documents_clinical',
  consent: 'ipd_documents',
  death_summary: 'ipd_documents_clinical',
  dama_form: 'ipd_documents',
  referral_letter: 'ipd_documents_clinical',
  estimate: 'ipd_documents',
};

/** Per-clinic overrides, doc_type → required permission */
export type DocTypeAccessMap = Record<string, DocAuthorPermission>;

/** The permission a doc type needs in this clinic (override, else built-in) */
export const docTypePermission = (
  docType: string,
  access?: DocTypeAccessMap
): DocAuthorPermission =>
  access?.[docType] ?? DEFAULT_DOC_TYPE_PERMISSION[docType] ?? 'ipd_documents';

/**
 * May this user author the type? The doctor's key covers nursing documents —
 * a consultant writing the nursing sheet is normal; the reverse is not.
 * Mirrors public.ipd_can_author_doc().
 */
export const canAuthorDocType = (
  docType: string,
  hasPermission: (key: string) => boolean,
  access?: DocTypeAccessMap
): boolean => {
  const perm = docTypePermission(docType, access);
  return (
    hasPermission(perm) ||
    (perm === 'ipd_documents_nursing' && hasPermission('ipd_documents_clinical'))
  );
};

/** Kept for callers that only care about the doctor-owned types */
export const isClinicalDocType = (docType: string, access?: DocTypeAccessMap): boolean =>
  docTypePermission(docType, access) === 'ipd_documents_clinical';

/**
 * An RLS refusal on ipd_documents reads "new row violates row-level security
 * policy…", which tells a ward user nothing. There is exactly one reason the
 * policy fires, so say it plainly.
 */
export const documentErrorMessage = (e: unknown): string => {
  const msg = (e as Error)?.message ?? 'Something went wrong';
  return /row-level security/i.test(msg)
    ? 'You are not allowed to write this document type — the treating doctor signs assessments, case sheets, OT notes, discharge/death summaries and referrals. Masters → Document Templates shows who may write each type.'
    : msg;
};

// ---------------------------------------------------------------------------
// Placeholder catalog — every {{key}} the resolver understands. The Template
// Studio shows these as insert chips; keep labels operator-friendly.
// ---------------------------------------------------------------------------
export const PLACEHOLDER_CATALOG: { key: string; label: string }[] = [
  { key: 'patient.name', label: 'Patient name' },
  { key: 'patient.uhid', label: 'UHID' },
  { key: 'patient.age', label: 'Age' },
  { key: 'patient.gender', label: 'Gender' },
  { key: 'patient.age_sex', label: 'Age / Sex' },
  { key: 'patient.phone', label: 'Phone' },
  { key: 'patient.blood_group', label: 'Blood group' },
  { key: 'patient.allergies', label: 'Allergies' },
  { key: 'admission.number', label: 'Admission no' },
  { key: 'admission.date', label: 'Admission date' },
  { key: 'admission.datetime', label: 'Admission date & time' },
  { key: 'admission.bed', label: 'Ward / bed' },
  { key: 'admission.attendant', label: 'Attendant (name & phone)' },
  { key: 'today', label: 'Today’s date' },
  { key: 'now', label: 'Date & time now' },
  { key: 'vitals.chart', label: 'Vitals chart (all recorded rounds)' },
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
  { key: 'io.chart', label: 'Intake / output chart (all timed entries, with balance)' },
  { key: 'medications.administered', label: 'Medication administration record (eMAR — timed, with nurse)' },
  { key: 'notes.nursing', label: 'Nursing observations (timed, with nurse)' },
  { key: 'tasks.done', label: 'Nursing care given (completed tasks, timed)' },
  { key: 'plan.today', label: 'Today’s treatment plan (S/O/A/P entries with times)' },
  { key: 'notes.course', label: 'Hospital course (treatment plan + round notes)' },
  { key: 'narrative.course', label: 'Hospital course — AI narrative (falls back to round notes)' },
  { key: 'narrative.advice', label: 'Advice & follow-up — AI narrative' },
  { key: 'narrative.condition', label: 'Condition at discharge — AI narrative' },
];

// Bumped whenever a built-in template changes; auto-created default templates
// below this version are upgraded in place (Studio edits bump the row version
// past this, so customized templates are never touched).
const DEFAULT_TEMPLATE_VERSION = 6;

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
  initial_assessment: [
    'Present Complaints', 'History of Present Illness', 'Past History',
    'Family History', 'Personal History', 'Physical Examination',
    'Systemic Examination', 'Local Examination', 'Provisional Diagnosis',
    'Treatment Plan',
  ],
  case_sheet: ['Details', 'Management'],
  nursing_chart: [
    'Vitals', 'Intake & Output', 'Nursing Observations', 'Care Given',
  ],
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
    <td style="padding:2px 4px"><b>UHID:</b> {{patient.uhid}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px" colspan="2"><b>Diagnosis:</b> {{admission.diagnosis}}</td>
  </tr>
</table>`;

// ---------------------------------------------------------------------------
// Ward sheets — the paperwork the ward runs on, laid out the way it is written
// by hand: a dated title, the patient strip, then the sheet's own body. These
// are seeded for every clinic by "Seed defaults" and stay editable in the
// Template Studio.
// ---------------------------------------------------------------------------

/** Patient strip used by the ward sheets (Name / Age-Sex / Room / UHID / IPD No) */
const WARD_HEADER_BLOCK = `<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:10px">
  <tr>
    <td style="padding:2px 4px"><b>Name of Patient:</b> {{patient.name}}</td>
    <td style="padding:2px 4px"><b>Age / Sex:</b> {{patient.age_sex}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Room:</b> {{admission.bed}}</td>
    <td style="padding:2px 4px"><b>UHID:</b> {{patient.uhid}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>IPD No:</b> {{admission.number}}</td>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
  </tr>
</table>`;

/** Title line every ward sheet opens with */
const wardSheetHead = (title: string) => `<p style="margin:0;font-size:13px"><b>Date:</b> {{today}}</p>
<h2 style="text-align:center;margin:2px 0 8px">${title}</h2>
${WARD_HEADER_BLOCK}`;

/** Doctor's signature strip closing a ward sheet */
const WARD_SIGN_BLOCK = `<table style="width:100%;font-size:13px;margin-top:18px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Sign: ____________________</td>
  </tr>
</table>`;

const DEFAULT_INITIAL_ASSESSMENT_TEMPLATE = `${wardSheetHead('INITIAL DOCTOR ASSESSMENT')}
<h3>Present Complaints</h3>
<p>{{admission.reason}}</p>

<h3>History of Present Illness</h3>
<p></p>

<h3>Past History</h3>
<p></p>

<h3>Family History</h3>
<p></p>

<h3>Personal History</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse">
  <tr>
    <td style="padding:2px 4px"><b>Diet:</b> </td>
    <td style="padding:2px 4px"><b>Appetite:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Bowel / Bladder:</b> </td>
    <td style="padding:2px 4px"><b>Sleep:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Addiction:</b> </td>
    <td style="padding:2px 4px"><b>Current Medication:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px" colspan="2"><b>Allergy:</b> {{patient.allergies}}</td>
  </tr>
</table>

<h3>Physical Examination</h3>
<p><b>Vitals:</b> {{vitals.latest}}</p>
<p><b>Sensorium:</b> Conscious &nbsp;·&nbsp; <b>Pallor:</b> &nbsp;·&nbsp; <b>Icterus:</b> &nbsp;·&nbsp;
<b>Cyanosis:</b> &nbsp;·&nbsp; <b>Oedema:</b> &nbsp;·&nbsp; <b>Lymphadenopathy:</b> </p>

<h3>Systemic Examination</h3>
<p><b>P/A:</b> &nbsp;·&nbsp; <b>R/S:</b> &nbsp;·&nbsp; <b>CVS:</b> &nbsp;·&nbsp; <b>CNS:</b> </p>

<h3>Local Examination</h3>
<ul>
  <li><b>Inspection:</b> </li>
  <li><b>Palpation:</b> </li>
  <li><b>Special examination (P/R, proctoscopy, probing, etc.):</b> </li>
</ul>

<h3>Investigations</h3>
{{investigations.list}}

<h3>Provisional Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Treatment Plan</h3>
<p></p>
${WARD_SIGN_BLOCK}
`;

/**
 * IPD Case Sheet — the running order sheet. One block per round: when it was
 * written, what was found (Details) and what was ordered (Management). The
 * first block is pre-filled from the chart; the two blanks below are for the
 * rounds that follow, and more can be pasted in the editor.
 */
const caseSheetEntry = (details: string, management: string) =>
  `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px">
  <tr>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f1f5f9;width:50%">
      <b>Date &amp; Time of Order:</b> ____________________
    </td>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f1f5f9">
      Seen by: Dr. ____________________
    </td>
  </tr>
  <tr>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f8fafc"><b>Details</b></td>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f8fafc"><b>Management</b></td>
  </tr>
  <tr>
    <td style="border:1px solid #cbd5e1;padding:6px;vertical-align:top;height:110px">${details}</td>
    <td style="border:1px solid #cbd5e1;padding:6px;vertical-align:top">${management}</td>
  </tr>
  <tr>
    <td style="border:1px solid #cbd5e1;padding:4px 6px" colspan="2">Sign: ____________________</td>
  </tr>
</table>`;

const DEFAULT_CASE_SHEET_TEMPLATE = `${wardSheetHead('IPD CASE SHEET')}
${caseSheetEntry(
  `<p><b>S/B</b> Dr. {{doctor.name}}</p><p><b>Vitals:</b> {{vitals.latest}}</p>
    <p><b>C/O:</b> {{admission.reason}}</p><p><b>Diagnosis:</b> {{admission.diagnosis}}</p>`,
  // The day's plan of care, not a blank the round has to re-write. Entries
  // come across timed and initialled; anything decided after printing goes in
  // the empty blocks below.
  `<p><b>Plan of care today:</b></p>{{plan.today}}<p>Further orders:</p><ul><li></li><li></li></ul>`
)}
${caseSheetEntry('<p></p>', '<p></p>')}
${caseSheetEntry('<p></p>', '<p></p>')}
`;

/**
 * Nursing Sheet — the ward's own record, drawn from what was actually charted
 * rather than printed blank. Every block carries the clinical time and the
 * nurse behind it; three blank rows follow each so the shift can keep writing
 * on the printed copy.
 */
const blankRows = (cols: number, count = 3): string =>
  Array.from({ length: count })
    .map(
      () =>
        `<tr>${Array.from({ length: cols })
          .map((_, i) => `<td style="border:1px solid #cbd5e1${i === 0 ? ';padding:8px 5px' : ''}"></td>`)
          .join('')}</tr>`
    )
    .join('');

const DEFAULT_NURSING_CHART_TEMPLATE = `${wardSheetHead('NURSING SHEET')}
<h3>Vitals</h3>
{{vitals.chart}}
<table style="width:100%;border-collapse:collapse;font-size:12px">${blankRows(8)}</table>

<h3>Intake &amp; Output</h3>
{{io.chart}}
<table style="width:100%;border-collapse:collapse;font-size:12px">${blankRows(6)}</table>

<h3>Diet</h3>
<p>{{diet.current}}</p>

<h3>Medication Administered</h3>
{{medications.administered}}

<h3>Nursing Observations</h3>
{{notes.nursing}}
<p></p>

<h3>Care Given</h3>
{{tasks.done}}
<p></p>

<table style="width:100%;font-size:13px;margin-top:18px">
  <tr>
    <td>Staff Nurse: ____________________</td>
    <td style="text-align:right">Sign: ____________________</td>
  </tr>
</table>
`;

const DEFAULT_OT_NOTE_TEMPLATE = `${wardSheetHead('REPORT OF SURGERY')}
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:10px">
  <tr>
    <td style="padding:2px 4px"><b>Date &amp; time of surgery:</b> {{now}}</td>
    <td style="padding:2px 4px"><b>Surgeon:</b> Dr. {{doctor.name}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Assistant(s):</b> </td>
    <td style="padding:2px 4px"><b>Anaesthetist:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Anaesthesia:</b> </td>
    <td style="padding:2px 4px"><b>Position:</b> </td>
  </tr>
</table>

<h3>Pre-operative Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Post-operative Diagnosis</h3>
<p></p>

<h3>Procedure Performed</h3>
<p></p>

<h3>Operative Findings</h3>
<p></p>

<h3>Procedure in Detail</h3>
<p></p>

<h3>Specimen / Implants</h3>
<p></p>

<h3>Blood Loss &amp; Fluids</h3>
<p></p>

<h3>Post-operative Instructions</h3>
<ul><li></li><li></li><li></li></ul>
${WARD_SIGN_BLOCK}
`;

/** Doc types with a hand-written built-in template rather than a skeleton */
const BESPOKE_TEMPLATES: Record<string, string> = {
  discharge_summary: DEFAULT_DISCHARGE_TEMPLATE,
  initial_assessment: DEFAULT_INITIAL_ASSESSMENT_TEMPLATE,
  case_sheet: DEFAULT_CASE_SHEET_TEMPLATE,
  nursing_chart: DEFAULT_NURSING_CHART_TEMPLATE,
  ot_note: DEFAULT_OT_NOTE_TEMPLATE,
};

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

/** The built-in template body for a doc type — some have a bespoke one */
const defaultTemplateHtml = (docType: string): string =>
  BESPOKE_TEMPLATES[docType] ?? buildSkeletonTemplate(docType);

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
function buildCourseNotesHtml(notes: NursingNote[], plans: TreatmentPlan[]): string {
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

// ---------------------------------------------------------------------------
// Ward chart blocks. Everything below prints a legal record, so each one shows
// the CLINICAL time — when the reading was taken, the fluid given, the drug
// administered — and the person behind it. Where the entry was keyed in
// noticeably later than it happened, the lag is printed too rather than
// quietly presenting a late entry as a bedside one.
// ---------------------------------------------------------------------------

const CELL = 'border:1px solid #cbd5e1;padding:3px 5px';
const HEAD_CELL = `${CELL};background:#f1f5f9;text-align:left`;

const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

/** Charting more than this after the event is worth showing on the sheet */
const LATE_CHART_MS = 10 * 60_000;

/**
 * "02 Sep 06:00" — with "(charted 10:12)" appended when the row was entered
 * appreciably after the event. charted_at is database-set and immutable, so
 * this is the one column on the sheet nobody can have edited.
 */
const fmtCharted = (at: string, chartedAt?: string | null): string => {
  const shown = fmtTime(at);
  if (!chartedAt) return shown;
  const lag = new Date(chartedAt).getTime() - new Date(at).getTime();
  if (lag < LATE_CHART_MS) return shown;
  return `${shown} (charted ${new Date(chartedAt).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit',
  })})`;
};

/** Staff name without the honorific the ward already prints */
const who = (p?: { name: string | null } | null): string =>
  p?.name ? p.name.replace(/^dr\.?\s*/i, '') : '';

const table = (heads: string[], rows: string): string =>
  `<table style="width:100%;border-collapse:collapse;font-size:12px">
  <tr>${heads.map((h) => `<th style="${HEAD_CELL}">${h}</th>`).join('')}</tr>
  ${rows}
</table>`;

const row = (cols: string[]): string =>
  `<tr>${cols.map((c) => `<td style="${CELL}">${c}</td>`).join('')}</tr>`;

/**
 * Every charted vitals round as one table — the body of the Nursing Sheet.
 * Rounds run oldest-first the way the ward writes them. The Sign column
 * carries whoever charted the round; it stays blank (for a wet signature) only
 * when the row has no recorded_by.
 */
function buildVitalsChartHtml(vitals: Vitals[]): string {
  if (vitals.length === 0) {
    return '<p>[No vitals charted yet — record them under Nursing, or fill this sheet by hand]</p>';
  }
  const rows = [...vitals]
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .map((v) =>
      row([
        esc(fmtCharted(v.recorded_at, v.charted_at)),
        esc(v.bp_systolic != null ? `${v.bp_systolic}/${v.bp_diastolic ?? '—'}` : '—'),
        esc(v.pulse != null ? String(v.pulse) : '—'),
        esc(v.spo2 != null ? `${v.spo2}%` : '—'),
        esc(v.temperature != null ? `${v.temperature}°C` : 'Afebrile'),
        esc(v.resp_rate != null ? String(v.resp_rate) : '—'),
        esc(v.blood_sugar != null ? String(v.blood_sugar) : '—'),
        esc(who(v.recorder)),
      ])
    )
    .join('');
  return table(
    ['Date &amp; Time', 'BP (mmHg)', 'Pulse /min', 'SpO₂', 'Temp', 'RR /min', 'Sugar', 'Sign'],
    rows
  );
}

/**
 * Charted intake and output, oldest-first, with the running balance the ward
 * actually wants off this sheet. Intake and output land in their own columns
 * so a shift total can be read down the page.
 */
function buildIoChartHtml(io: IntakeOutput[]): string {
  if (io.length === 0) {
    return '<p>[No intake/output charted — record it under Nursing, or fill this sheet by hand]</p>';
  }
  let intake = 0;
  let output = 0;
  const rows = [...io]
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .map((e) => {
      const isIn = e.io_type === 'intake';
      if (isIn) intake += e.volume_ml;
      else output += e.volume_ml;
      return row([
        esc(fmtCharted(e.recorded_at, e.charted_at)),
        esc(e.route.replace(/_/g, ' ')),
        isIn ? esc(`${e.volume_ml} ml`) : '',
        isIn ? '' : esc(`${e.volume_ml} ml`),
        esc(String(intake - output)),
        esc([e.notes, who(e.recorder)].filter(Boolean).join(' · ')),
      ]);
    })
    .join('');
  const total = `<tr>
    <td style="${CELL};background:#f8fafc" colspan="2"><b>Total</b></td>
    <td style="${CELL};background:#f8fafc"><b>${intake} ml</b></td>
    <td style="${CELL};background:#f8fafc"><b>${output} ml</b></td>
    <td style="${CELL};background:#f8fafc"><b>${intake - output} ml</b></td>
    <td style="${CELL};background:#f8fafc"></td>
  </tr>`;
  return table(
    ['Date &amp; Time', 'Route', 'Intake', 'Output', 'Balance', 'Notes / Sign'],
    rows + total
  );
}

/**
 * The eMAR proper: what was actually given, when, and by whom — as distinct
 * from {{medications.course}}, which is the list of drugs ORDERED. A nursing
 * sheet that shows only orders claims nothing about administration, which is
 * the one thing this sheet exists to evidence.
 */
async function buildAdministeredMedsHtml(admissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ipd_medication_administrations')
    .select(`administered_at, status, reason,
             nurse:profiles!ipd_medication_administrations_administered_by_fkey(name),
             schedule:ipd_medication_schedule(
               scheduled_at,
               medication_order:ipd_medication_orders(medicine_name, dose, route))`)
    .eq('admission_id', admissionId)
    .order('administered_at', { ascending: true });
  if (error || !data || data.length === 0) {
    return '<p>[No doses recorded against the eMAR — enter them under Nursing &amp; Medications, or sign this sheet by hand]</p>';
  }

  const rows = (data as any[])
    .map((a) => {
      const order = a.schedule?.medication_order;
      const drug = [order?.medicine_name, order?.dose, fmtRoute(order?.route ?? null)]
        .filter(Boolean)
        .join(' ');
      const due = a.schedule?.scheduled_at ? fmtTime(a.schedule.scheduled_at) : '—';
      const status =
        a.status === 'given'
          ? 'Given'
          : `${a.status.charAt(0).toUpperCase()}${a.status.slice(1)}${a.reason ? ` — ${a.reason}` : ''}`;
      return row([
        esc(due),
        esc(fmtTime(a.administered_at)),
        esc(drug || '—'),
        esc(status),
        esc(who(a.nurse)),
      ]);
    })
    .join('');
  return table(['Due', 'Given at', 'Drug / Dose / Route', 'Status', 'Sign'], rows);
}

/**
 * The nurse's own running observations. buildCourseNotesHtml deliberately
 * keeps only the doctor's notes for the discharge summary's hospital course;
 * these are the other half, and they belong on the nursing sheet.
 */
function buildNursingNotesHtml(notes: NursingNote[]): string {
  const own = notes
    .filter((n) => ['nursing', 'handover', 'procedure'].includes(n.note_type))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (own.length === 0) return '<p></p>';

  return own
    .map((n) => {
      const tag = n.note_type === 'nursing' ? '' : ` <i>(${n.note_type})</i>`;
      const sign = who(n.author);
      return `<p style="margin:3px 0"><b>${esc(fmtCharted(n.created_at, n.charted_at))}</b>${tag} — ${esc(
        n.note
      )}${sign ? ` <i>— ${esc(sign)}</i>` : ''}</p>`;
    })
    .join('');
}

/** Nursing tasks signed off — the "care given" half of the nursing sheet */
async function buildTasksDoneHtml(admissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ipd_nursing_tasks')
    .select('task, due_at, done_at, nurse:profiles!ipd_nursing_tasks_done_by_fkey(name)')
    .eq('admission_id', admissionId)
    .eq('status', 'done')
    .not('done_at', 'is', null)
    .order('done_at', { ascending: true });
  if (error) return '<p></p>';

  const done = (data ?? []) as any[];
  if (done.length === 0) return '<p></p>';

  const rows = done
    .map((t) =>
      row([
        esc(fmtTime(t.done_at)),
        esc(t.task),
        esc(t.due_at ? fmtTime(t.due_at) : '—'),
        esc(who(t.nurse)),
      ])
    )
    .join('');
  return table(['Done at', 'Care given', 'Was due', 'Sign'], rows);
}

/**
 * Today's treatment plan, for the case sheet's first order block. The case
 * sheet is the doctor's running order sheet, so it should open with what was
 * actually planned today rather than making the round re-write it by hand.
 */
function buildTodayPlanHtml(plans: TreatmentPlan[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const mine = plans
    .filter((p) => p.plan_date === today && p.status === 'active')
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  if (mine.length === 0) return '<p></p>';

  return mine
    .map((p) => {
      const lines = ([
        ['S', p.subjective], ['O', p.objective], ['A', p.assessment],
        ['Plan', p.plan], ['Advice', p.advice],
      ] as Array<[string, string | null]>)
        .filter(([, v]) => v && v.trim())
        .map(([label, v]) => `<i>${label}:</i> ${esc(v!)}`)
        .join('<br/>');
      if (!lines) return '';
      const at = new Date(p.recorded_at).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit',
      });
      const doc = who(p.doctor);
      return `<p style="margin:3px 0"><b>${esc(at)}</b>${doc ? ` <i>Dr. ${esc(doc)}</i>` : ''}<br/>${lines}</p>`;
    })
    .filter(Boolean)
    .join('');
}

async function buildPlaceholderMap(admission: Admission): Promise<Record<string, string>> {
  const [
    vitals, io, notes, plans, medOrders,
    investigations, reports, consultations, diet, administered, tasksDone,
  ] = await Promise.all([
    nursingService.listVitals(admission.id, 60).catch(() => []),
    nursingService.listIO(admission.id, 200).catch(() => []),
    // Fetched once here and shared: the hospital course wants the doctor's
    // notes, the nursing sheet wants the nurse's, and both come off this list.
    nursingService.listNotes(admission.id, 200).catch(() => []),
    treatmentPlanService.list(admission.id).catch(() => []),
    supabase
      .from('ipd_medication_orders')
      .select('*')
      .eq('admission_id', admission.id)
      .then(({ data }) => (data ?? []) as MedicationOrder[]),
    buildInvestigationsHtml(admission.id),
    buildReportsHtml(admission.id),
    buildConsultationsHtml(admission.id),
    buildDietHtml(admission.id),
    buildAdministeredMedsHtml(admission.id),
    buildTasksDoneHtml(admission.id),
  ]);
  const courseNotes = buildCourseNotesHtml(notes, plans);
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
  const fmtDateTime = (d: string | null | undefined) =>
    d
      ? new Date(d).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : '—';

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
    'patient.uhid': admission.patient?.patient_number ?? '—',
    'patient.age': String(admission.patient?.age ?? ''),
    'patient.gender': admission.patient?.gender ?? '',
    'patient.age_sex': [
      admission.patient?.age != null ? String(admission.patient.age) : '—',
      admission.patient?.gender
        ? admission.patient.gender.charAt(0).toUpperCase()
        : '—',
    ].join(' / '),
    'patient.phone': admission.patient?.phone ?? '',
    'patient.blood_group': admission.patient?.blood_group ?? '—',
    'patient.allergies': admission.patient?.allergies?.join(', ') || 'None known',
    'admission.number': admission.admission_number,
    'admission.date': fmt(admission.admission_datetime),
    'admission.datetime': fmtDateTime(admission.admission_datetime),
    'admission.attendant': [admission.attendant_name, admission.attendant_phone]
      .filter(Boolean)
      .join(' · ') || '—',
    today: fmt(new Date().toISOString()),
    now: fmtDateTime(new Date().toISOString()),
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
    'vitals.chart': buildVitalsChartHtml(vitals),
    'io.chart': buildIoChartHtml(io),
    'medications.discharge': buildDischargeMedsHtml(medOrders),
    'medications.course': buildCourseMedsHtml(medOrders),
    'medications.administered': administered,
    'investigations.list': investigations,
    'reports.list': reports,
    'consultations.list': consultations,
    'diet.current': diet,
    'notes.nursing': buildNursingNotesHtml(notes),
    'tasks.done': tasksDone,
    'plan.today': buildTodayPlanHtml(plans),
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

  /**
   * Create the built-in template for every document type this clinic has none
   * for, and upgrade the untouched ones — what "Seed defaults" in Masters
   * calls so a fresh clinic starts with the whole ward paperwork set.
   * Returns how many were created/upgraded.
   */
  async seedDefaultTemplates(clinicId: string): Promise<number> {
    const before = await this.listTemplates(clinicId);
    let touched = 0;
    for (const { key } of DOC_TYPES) {
      const existing = before.find(
        (t) => t.doc_type === key && t.name === defaultTemplateName(key)
      );
      // a clinic that renamed or edited its default is left alone
      if (existing && (existing.version ?? 1) > DEFAULT_TEMPLATE_VERSION) continue;
      const isNew = !before.some((t) => t.doc_type === key);
      try {
        await this.getOrCreateDefaultTemplate(clinicId, key);
        if (isNew || existing) touched += 1;
      } catch {
        // one bad type must not abort the seed — the rest still land
      }
    }
    return touched;
  },

  // --- Who may write each document type -------------------------------------

  /** Per-clinic overrides of the built-in authorship map */
  async listDocTypeAccess(clinicId: string): Promise<DocTypeAccessMap> {
    const { data, error } = await supabase
      .from('ipd_doc_type_access')
      .select('doc_type, required_permission')
      .eq('clinic_id', clinicId);
    if (error) return {};
    return Object.fromEntries(
      (data ?? []).map((r) => [r.doc_type, r.required_permission as DocAuthorPermission])
    );
  },

  /** Set (or clear, back to the built-in) who may write a document type */
  async setDocTypeAccess(params: {
    clinicId: string;
    docType: string;
    permission: DocAuthorPermission | null;
    userId?: string;
  }): Promise<void> {
    if (params.permission === null) {
      const { error } = await supabase
        .from('ipd_doc_type_access')
        .delete()
        .eq('clinic_id', params.clinicId)
        .eq('doc_type', params.docType);
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from('ipd_doc_type_access').upsert(
      {
        clinic_id: params.clinicId,
        doc_type: params.docType,
        required_permission: params.permission,
        updated_at: new Date().toISOString(),
        updated_by: params.userId ?? null,
      },
      { onConflict: 'clinic_id,doc_type' }
    );
    if (error) throw error;
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

  // --- pre-admission ("free") estimates --------------------------------------
  //
  // The cost estimate is the one document a hospital writes BEFORE the patient
  // is admitted — the family and the TPA both want the figure first. These rows
  // carry a patient_id and no admission_id; when the patient is later admitted
  // the estimate stays attached to them, not to the (then non-existent) stay.

  /**
   * Start a pre-admission estimate for a patient who has no admission yet.
   * The class, consultant and diagnosis picked on the form stand in for what
   * buildPlaceholderMap would normally read off the chart.
   */
  async createPreAdmissionEstimate(params: {
    clinicId: string;
    patient: {
      id: string; name: string; age?: number | string | null;
      gender?: string | null; allergies?: string[] | null;
    };
    bedClassLabel: string;
    doctorName: string;
    diagnosis: string;
    /** the ComposeSubject this estimate is quoted against, stored with the row */
    subjectContext?: unknown;
    templateId?: string;
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
      template = await this.getOrCreateDefaultTemplate(params.clinicId, 'estimate');
    }

    const today = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    const { data: docNumber } = await supabase.rpc('next_document_number', {
      p_clinic_id: params.clinicId,
      p_doc_type: 'estimate',
    });

    // Nothing on the chart to merge — only what the form supplied. Every other
    // placeholder resolves to a bracketed prompt so it prints as "to be filled"
    // rather than as a raw {{token}}.
    const map: Record<string, string> = {
      'patient.name': params.patient.name,
      'patient.age': String(params.patient.age ?? ''),
      'patient.gender': params.patient.gender ?? '',
      'patient.allergies': (params.patient.allergies ?? []).join(', ') || 'None known',
      'admission.number': (docNumber as string) ?? 'Pre-admission',
      'admission.date': today,
      'admission.bed': params.bedClassLabel,
      'admission.diagnosis': params.diagnosis,
      'admission.reason': params.diagnosis,
      'doctor.name': params.doctorName.replace(/^dr\.?\s*/i, ''),
      'discharge.date': today,
      today,
      now: new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      }),
    };
    const content = resolvePlaceholders(template.html_template, map).replace(
      /\{\{\s*[\w.]+\s*\}\}/g,
      '<i style="color:#94a3b8">[to be filled]</i>'
    );

    const { data, error } = await supabase
      .from('ipd_documents')
      .insert({
        clinic_id: params.clinicId,
        admission_id: null,
        patient_id: params.patient.id,
        template_id: template.id,
        doc_type: 'estimate',
        document_number: (docNumber as string) ?? null,
        content_html: content,
        subject_context: params.subjectContext ?? null,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as IpdDocument;
  },

  /** The pre-admission estimate worklist for a clinic */
  async listPreAdmissionEstimates(
    clinicId: string,
    limit = 100
  ): Promise<Array<IpdDocument & { patient?: { id: string; name: string; phone: string | null } }>> {
    const { data, error } = await supabase
      .from('ipd_documents')
      .select('*, patient:patients(id, name, phone)')
      .eq('clinic_id', clinicId)
      .eq('doc_type', 'estimate')
      .is('admission_id', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as Array<
      IpdDocument & { patient?: { id: string; name: string; phone: string | null } }
    >;
  },

  async deleteDocument(documentId: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_documents')
      .delete()
      .eq('id', documentId)
      .eq('status', 'draft');
    if (error) throw error;
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

  /**
   * TPA claim annexure: the package price broken into heads, ending in the
   * residual line. Totals the agreed price exactly — the patient's own bill
   * still carries the single package line.
   */
  async printPackageBreakup(params: {
    lines: Array<{ description: string; quantity: number; unit_rate: number; net: number; is_residual: boolean }>;
    packageName: string;
    agreedPrice: number;
    admission: Admission;
    clinicId: string;
  }): Promise<void> {
    const { lines, packageName, agreedPrice, admission } = params;
    const clinic = await getClinicInfo(params.clinicId);
    const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const barcode = generateBarcodeDataUrl(admission.admission_number, { height: 30, fontSize: 9, margin: 2 });

    // Every head prints identically. The residual is an ordinary line to the
    // payer — nothing on the annexure should advertise it as a balancing figure.
    const rows = lines.map((l) => `
      <tr>
        <td>${esc(l.description)}</td>
        <td class="r">${l.quantity}</td>
        <td class="r">${inr(l.unit_rate)}</td>
        <td class="r">${inr(l.net)}</td>
      </tr>`).join('');

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(admission.admission_number)} — package break-up</title>
  <style>
    @page { size: A4; margin: 15mm 12mm 18mm 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .letterhead { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .letterhead h1 { margin: 0; font-size: 17px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .meta { display: flex; justify-content: space-between; font-size: 11px;
      background: #f4f6f8; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #666;
      border-bottom: 1px solid #bbb; padding: 4px 6px; }
    td { padding: 4px 6px; border-bottom: 1px solid #eee; }
    .r { text-align: right; }
    .totals { margin-top: 10px; margin-left: auto; width: 55%; font-size: 12px; }
    .totals td { padding: 3px 6px; }
    .totals .grand td { font-size: 14px; font-weight: bold; border-top: 2px solid #1F5065; }
    .sign { margin-top: 30px; display: flex; justify-content: space-between; font-size: 11px; }
    .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9.5px; color: #777;
      border-top: 1px solid #ddd; padding-top: 3px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="letterhead">
    ${letterheadInner(clinic, 'Package Break-up — Claim Annexure')}
    <img src="${barcode}" alt="${esc(admission.admission_number)}" style="height:32px" />
  </div>

  <div class="meta">
    <div>
      <b>${esc(admission.patient?.name ?? '')}</b>
      (${admission.patient?.age ?? '—'}y / ${esc(admission.patient?.gender ?? '—')})<br/>
      ${esc(admission.patient?.phone ?? '')}
    </div>
    <div>
      Admission: <b>${esc(admission.admission_number)}</b><br/>
      Admitted: ${fmt(admission.admission_datetime)}
    </div>
    <div>
      Package: <b>${esc(packageName)}</b><br/>
      Agreed: ${inr(agreedPrice)}
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Head</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr class="grand"><td>Package Total</td><td class="r">${inr(agreedPrice)}</td></tr>
  </table>

  <div class="sign">
    <span>Patient / Attendant Signature</span>
    <span>Authorised Signatory</span>
  </div>

  <div class="footer">
    <span>${esc(admission.admission_number)} · package break-up</span>
    <span>Generated ${new Date().toLocaleString('en-IN')}</span>
  </div>
</body>
</html>`;
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
  }): Promise<GeneratedPdf> {
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
    return {
      url: data.url as string,
      shareUrl: data.shareUrl ?? undefined,
      token: data.token ?? undefined,
      temporary: Boolean(data.temporary),
      cached: Boolean(data.cached),
    };
  },

  /**
   * Server-side PDF for a signed document (discharge summary etc.).
   * Permanent URL lands on ipd_documents.pdf_url in the background.
   */
  async generateDocumentPdf(params: {
    doc: IpdDocument;
    /** null for a pre-admission estimate — there is no admission yet */
    admission: Admission | null;
    clinicId: string;
    forceRegenerate?: boolean;
  }): Promise<GeneratedPdf> {
    const ref = params.admission?.admission_number ?? params.doc.document_number ?? 'ESTIMATE';
    const barcode = generateBarcodeDataUrl(ref, {
      height: 30, fontSize: 9, margin: 2,
    });
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px;line-height:1.45;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;color:#555;">
            ${params.doc.document_number ?? ''} · ${ref}
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
    return {
      url: data.url as string,
      shareUrl: data.shareUrl ?? undefined,
      token: data.token ?? undefined,
      temporary: Boolean(data.temporary),
      cached: Boolean(data.cached),
    };
  },

  /**
   * Print a document with a simple letterhead: clinic name header +
   * admission barcode (Code 128) top-right, footer with doc number.
   * (Server-side letterhead PDF via the LIMS pipeline comes later.)
   */
  async printDocument(params: {
    doc: IpdDocument;
    /** null for a pre-admission estimate — there is no admission yet */
    admission: Admission | null;
    clinicId: string;
  }): Promise<void> {
    const clinic = await getClinicInfo(params.clinicId);
    const ref = params.admission?.admission_number ?? params.doc.document_number ?? 'ESTIMATE';
    const barcode = generateBarcodeDataUrl(ref, {
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
    <div class="barcode"><img src="${barcode}" alt="${ref}" /></div>
  </div>
  ${params.doc.content_html}
  <div class="footer">
    <span>${params.doc.document_number ?? ''} · ${ref}</span>
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

  // An interim is a running statement, not a demand for payment. It must never
  // read as a bill on paper.
  const docLabel = bill.is_provisional
    ? 'PROVISIONAL STATEMENT'
    : `${bill.bill_type.toUpperCase()} BILL`;

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
    .provisional { border: 1px solid #b45309; background: #fffbeb; color: #92400e;
      border-radius: 6px; padding: 6px 9px; font-size: 10.5px; margin-bottom: 9px; }
  `;

  const headerBlock = letterhead
    ? `<div class="letterhead">
        ${letterheadInner(clinic, `Inpatient Department — ${docLabel}`)}
        <img src="${barcode}" alt="${admission.admission_number}" style="height:32px" />
      </div>`
    : `<div class="billtitle">
        <b>${docLabel} — INPATIENT DEPARTMENT</b>
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

  ${bill.is_provisional ? `<div class="provisional">
    Provisional — charges recorded up to ${fmt(bill.bill_datetime)}. Not a demand for payment
    and not a tax invoice. The final bill issued at discharge carries every item of this admission.
  </div>` : ''}

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
    <tr><td><b>${bill.is_provisional ? 'Total Charges To Date' : 'Net Payable'}</b></td><td class="r"><b>${inr(bill.net_total)}</b></td></tr>
    ${bill.deposits_applied > 0 ? `<tr><td>${bill.is_provisional ? 'Advance Held' : 'Deposits Applied'}</td><td class="r">− ${inr(bill.deposits_applied)}</td></tr>` : ''}
    ${bill.paid_amount > 0 ? `<tr><td>Payments Received</td><td class="r">− ${inr(bill.paid_amount)}</td></tr>` : ''}
    <tr class="grand"><td>${bill.is_provisional ? 'Balance If Settled Today' : 'Balance Due'}</td><td class="r">${inr(bill.balance_amount)}</td></tr>
  </table>

  ${bill.is_provisional ? '' : `<div class="sign">
    <span>Patient / Attendant Signature</span>
    <span>Authorised Signatory</span>
  </div>`}

  ${letterhead ? `<div class="footer">
    <span>${bill.bill_number} · ${admission.admission_number} · ${bill.is_provisional ? 'PROVISIONAL' : bill.status.toUpperCase()}</span>
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
