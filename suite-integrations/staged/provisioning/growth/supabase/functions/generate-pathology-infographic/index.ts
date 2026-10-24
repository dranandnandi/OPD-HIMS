import {withSuiteClient,guardEdge,runtimeFetch} from '../_shared/suite-runtime-guard.ts';
import { createClient as dsBase_createClient } from 'npm:@supabase/supabase-js@2.39.7';
const createClient=withSuiteClient(dsBase_createClient);

import {
  CALC_BANDS,
  CALC_FLOW,
  CALC_STEPS,
  CBC_FISHBONE,
  type DiagramTemplate,
  BIOCHEM_PANEL,
  LIPID_PANEL,
  SEROLOGY_PANEL,
  THYROID_PANEL,
  URINE_PANEL,
  VITAMINS_PANEL,
  renderDiagram,
} from './report-diagrams.ts';
import {
  PDFCO_PAGE_MARGINS,
  renderReportFooterHtml,
  renderReportHtml,
  SPOTLIGHT_KEYS,
  type ReportViewModel,
} from './report-template.ts';
import {
  type PatientBiometrics,
  type ExtractedLabValues,
  type CalculatedIndex,
  type CompositeScore,
  calculateAllIndices,
} from './clinical-calculations.ts';
import {
  getCalculableCompositeScores,
} from './composite-scores.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ReportType = 'smart_report' | 'trend_analysis' | 'longitivity_report';

interface GenerateRequest {
  request_id: string;
  patient_name: string;
  report_type: ReportType;
  summary_language?: string;
  notes?: string;
  letterhead_url?: string;
  uploaded_report_urls: string[];
  biometrics?: PatientBiometrics;
}

interface ExtractedTest {
  test_name: string;
  canonical_key?: keyof ExtractedLabValues | null;
  value: string;
  unit?: string;
  reference_range?: string;
  source_flag?: string | null;
  is_abnormal?: boolean;
  abnormal_direction?: 'high' | 'low' | null;
}

interface ExtractedSection {
  section_name: string;
  category?: string;
  tests: ExtractedTest[];
}

interface ExtractedReport {
  patient?: {
    name?: string;
    age?: string;
    sex?: string;
    report_date?: string;
    doctor_name?: string | null;
  };
  lab_info?: {
    name?: string;
    address?: string | null;
    phone?: string | null;
  };
  test_sections?: ExtractedSection[];
  abnormal_summary?: Array<{
    section: string;
    test_name: string;
    value: string;
    reference_range?: string;
    direction: 'high' | 'low';
  }>;
  patient_summary?: PatientSummary | null;
}

interface PatientSummary {
  health_status?: string;
  normal_findings_detailed?: Array<{
    test_name: string;
    value: string;
    what_it_measures: string;
    your_result_means: string;
  }>;
  abnormal_findings?: Array<{
    test_name: string;
    value: string;
    status: 'high' | 'low' | 'critical' | 'abnormal';
    what_it_measures: string;
    explanation: string;
    what_to_do: string;
    trend?: 'improving' | 'worsening' | 'stable' | 'new';
  }>;
  needs_consultation?: boolean;
  consultation_recommendation?: string;
  health_tips?: string[];
  summary_message?: string;
  language?: string;
}

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_EXTRACTION_MAX_TOKENS = 12000;
const DEFAULT_SUMMARY_MAX_TOKENS = 4096;

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi (हिन्दी)',
  mr: 'Marathi (मराठी)',
  gu: 'Gujarati (ગુજરાતી)',
  ta: 'Tamil (தமிழ்)',
  te: 'Telugu (తెలుగు)',
  kn: 'Kannada (ಕನ್ನಡ)',
  bn: 'Bengali (বাংলা)',
  pa: 'Punjabi (ਪੰਜਾਬੀ)',
  ml: 'Malayalam (മലയാളം)',
  or: 'Odia (ଓଡ଼ିଆ)',
  as: 'Assamese (অসমীয়া)',
};

const CANONICAL_LAB_KEYS = [
  'hemoglobin',
  'rbc',
  'wbc',
  'platelets',
  'mcv',
  'mch',
  'mchc',
  'rdw',
  'neutrophils',
  'lymphocytes',
  'monocytes',
  'eosinophils',
  'basophils',
  'hematocrit',
  'creatinine',
  'bun',
  'urea',
  'uric_acid',
  'ast',
  'alt',
  'alp',
  'ggt',
  'bilirubin_total',
  'bilirubin_direct',
  'albumin',
  'total_protein',
  'total_cholesterol',
  'hdl',
  'ldl',
  'vldl',
  'triglycerides',
  'fasting_glucose',
  'random_glucose',
  'hba1c',
  'insulin',
  'iron',
  'ferritin',
  'tibc',
  'transferrin_saturation',
  'vitamin_d',
  'vitamin_b12',
  'folate',
  'calcium',
  'phosphorus',
  'magnesium',
  'sodium',
  'potassium',
  'chloride',
  'crp',
  'esr',
  'tsh',
  't3',
  't4',
  'free_t3',
  'free_t4',
] as const satisfies readonly (keyof ExtractedLabValues)[];

const CANONICAL_LAB_KEY_SET = new Set<string>(CANONICAL_LAB_KEYS);

const PDF_EXTRACTION_PROMPT = `You are extracting structured data from pathology/laboratory report PDFs.

Return ONLY a JSON object with this structure:
{
  "patient": {
    "name": "string or null",
    "age": "string or null",
    "sex": "Male|Female|null",
    "report_date": "YYYY-MM-DD or original date text or null",
    "doctor_name": "string or null"
  },
  "lab_info": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null"
  },
  "test_sections": [
    {
      "section_name": "string",
      "category": "string",
      "tests": [
        {
          "test_name": "string",
          "canonical_key": "one allowed key from the canonical key list below, or null",
          "value": "string exactly as shown",
          "unit": "string or null",
          "reference_range": "string or null",
          "source_flag": "explicit flag/status exactly as printed in source report, e.g. N/H/L/Normal/High/Low, or null",
          "is_abnormal": boolean,
          "abnormal_direction": "high|low|null"
        }
      ]
    }
  ],
  "abnormal_summary": [
    {
      "section": "string",
      "test_name": "string",
      "value": "string",
      "reference_range": "string or null",
      "direction": "high|low"
    }
  ]
}

Canonical key list for calculation mapping:
${CANONICAL_LAB_KEYS.join(', ')}

Rules:
1. Extract all visible test values; do not skip sections.
2. Preserve exact values, units, dates, and reference ranges.
3. Extract source_flag only when the uploaded report visibly prints a flag/status for that exact test row. Do not create one from reference ranges.
4. Mark is_abnormal true only when a reference range is provided and the value falls outside it, or when the source report prints an abnormal flag (H/L/C) for that row. When reference_range is null and no abnormal flag is printed, set is_abnormal to false and leave the row out of abnormal_summary.
5. Do not infer symptoms, diagnoses, medications, procedures, lifestyle advice, or missing biomarkers.
6. If a field is unclear or absent, use null rather than guessing.
7. Preserve source dates and lab names for trend comparison.
8. For canonical_key, map common lab synonyms to the allowed key list. Examples: "Creatinine, Serum" -> "creatinine", "S. Creat" -> "creatinine", "LDL Cholesterol, Direct" -> "ldl", "Lymphocytes (Abs)" -> "lymphocytes", "Granulocyte Absolute" -> "neutrophils", "Total WBC Count" -> "wbc".
9. Use canonical_key null for display-only values, qualitative values, ratios that are already reported, or tests not represented in the allowed list. Derived rows such as "BUN/Creatinine Ratio", "Cholesterol/HDL Ratio", "Triglyceride/HDL Ratio", "A/G Ratio", and "Estimated Average Glucose (eAG)" must always have canonical_key null; they are computed from other rows and must never overwrite a primary value.
10. Do not invent a canonical_key outside the allowed list.`;

const GAMMA_INSTRUCTIONS = `
Create a professional, patient-friendly medical smart report that reads as a visual dashboard first and a document second.

CONTENT GROUNDING:
1. Use only the patient data, lab values, dates, reference ranges, counts, and trend data in the input.
2. Do not invent diagnoses, symptoms, medications, procedures, lifestyle habits, missing biomarkers, or doctor advice.
3. If a value, range, date, or trend is unavailable, label it "not available" or omit the comparison.
4. Never describe a value as "not in normal range", outside the normal range, or abnormal when its reference range is not available. If the lab printed a flag for it, cite that flag; otherwise present the value neutrally.
5. Use the pre-computed counts supplied in the input for every tile, chart, and scorecard. Do not recount rows.
6. Never say the patient is "perfectly healthy" or imply a diagnosis from one abnormal marker.
7. Do not omit any supplied lab value. Every supplied test row must appear in the final report.

VISUALS:
- Follow the per-section "Layout:" directives in the input: stat tiles, donut or stacked bar, domain scorecards, compact abnormal cards, value-vs-range bars, gauges, and status chips.
- Highlight abnormal values in red/amber; use green/blue accents for values within range.
- In lab tables use only the compact source flags provided (N, H, L, C); leave the flag cell blank when none is given, and show a legend only for flags that appear.

TEXT ECONOMY:
- Cap every interpretation at one line.
- Do not attach "discuss with your clinician" to individual items; the single "Questions to discuss with your clinician" section covers it.
- Keep the disclaimer as one thin footer strip and the calculation-availability note to one line.
- Avoid marketing phrases like "excellent health profile", "world-class", "complete transformation", or "highly recommended".
`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logStage(stage: string, details?: Record<string, unknown>) {
  console.log(`[generate-pathology-infographic] ${stage}`, details ? JSON.stringify(details) : '');
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'patient';
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extractJson(text: string): ExtractedReport {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not contain JSON');
    return JSON.parse(match[0]);
  }
}

function parseJsonObject<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not contain JSON');
    return JSON.parse(match[0]) as T;
  }
}

function getTargetLanguage(languageCode?: string) {
  const normalized = (languageCode || 'en').toLowerCase();
  return {
    code: normalized,
    name: LANGUAGE_NAMES[normalized] || LANGUAGE_NAMES.en,
  };
}

function getPositiveIntegerEnv(name: string, fallback: number) {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPatientInfo(data: ExtractedReport, input: GenerateRequest) {
  const patient = data.patient || {};
  const lab = data.lab_info || {};
  return [
    `Patient Name: ${patient.name || input.patient_name || 'not available'}`,
    `Age: ${patient.age || 'not available'}`,
    `Sex: ${patient.sex || 'not available'}`,
    `Report Date: ${patient.report_date || 'not available'}`,
    `Doctor: ${patient.doctor_name || 'not available'}`,
    `Lab: ${lab.name || 'not available'}`,
    input.notes ? `Request Notes: ${input.notes}` : '',
  ].filter(Boolean).join('\n');
}

function buildTestResultsSection(data: ExtractedReport) {
  return (data.test_sections || []).map((section) => {
    const tests = (section.tests || []).map((test) => {
      const sourceFlag = compactSourceFlag(test.source_flag);
      const abnormality = test.is_abnormal
        ? (test.abnormal_direction || 'abnormal').toUpperCase()
        : 'within range';
      return `- ${test.test_name}: ${test.value} ${test.unit || ''} | Ref: ${test.reference_range || 'not available'} | source flag: ${sourceFlag || 'not printed'} | abnormality: ${abnormality}`;
    }).join('\n');
    return `Section: ${section.section_name || 'Report Section'}\n${tests}`;
  }).join('\n\n');
}

function buildAbnormalFindingsForPrompt(data: ExtractedReport) {
  const abnormalSummary = data.abnormal_summary || [];
  if (abnormalSummary.length === 0) {
    return 'Abnormal Findings: none detected from provided flags/reference ranges.';
  }

  return [
    'Abnormal Findings:',
    ...abnormalSummary.map((item) =>
      `- ${item.test_name}: ${item.value} | status: ${item.direction} | Ref: ${item.reference_range || 'not available'} | Section: ${item.section}`
    ),
  ].join('\n');
}

function compactSourceFlag(sourceFlag?: string | null): string {
  const flag = (sourceFlag || '').trim();
  if (!flag) return '';

  const normalized = flag.toLowerCase();
  if (['n', 'normal', 'within normal limit', 'within normal limits', 'within range'].includes(normalized)) return 'N';
  if (['h', 'high', 'hi', 'above', 'above range'].includes(normalized)) return 'H';
  if (['l', 'low', 'lo', 'below', 'below range'].includes(normalized)) return 'L';
  if (['c', 'critical'].includes(normalized)) return 'C';
  if (flag.length <= 3) return flag.toUpperCase();
  return '';
}

function buildSourceFlagLegend(flags: Set<string>): string {
  const legendParts: string[] = [];
  if (flags.has('N')) legendParts.push('N = normal');
  if (flags.has('H')) legendParts.push('H = high');
  if (flags.has('L')) legendParts.push('L = low');
  if (flags.has('C')) legendParts.push('C = critical');
  return legendParts.length > 0 ? `Source flag legend: ${legendParts.join(', ')}.` : '';
}

function buildPatientSummaryPrompt(data: ExtractedReport, input: GenerateRequest) {
  const language = getTargetLanguage(input.summary_language);
  const patientInfo = buildPatientInfo(data, input);
  const testResultsSection = buildTestResultsSection(data);
  const abnormalFindingsForPrompt = buildAbnormalFindingsForPrompt(data);
  const historyNote = input.report_type === 'trend_analysis'
    ? 'History Note: If prior values are not provided, mark trend as "new" instead of guessing.'
    : 'History Note: No historical comparison is available unless explicitly present in the extracted data.';

  return `
You are a healthcare communicator creating a simple, reassuring summary of lab results for a patient.

LANGUAGE: Write in ${language.name}. Keep medical terms (CBC, Hemoglobin, HIV, HBsAg, etc.) in English.

FLAG RULES (authoritative):
- flag H/high = abnormal high | flag L/low = abnormal low | flag C/critical = critical | flag N/null = normal
- Do NOT re-evaluate numeric flags.
- EXCEPTION - qualitative results (text values, no flag): use your clinical knowledge of the analyte to determine normality. Example: HIV "Reactive" = abnormal; HBsAg "Reactive" = abnormal; Platelets "Detected" = normal (expected). Judge by what a normal result for that specific analyte should be.
- Never say a result is "not in normal range" or "outside the normal range" when its reference range is not available. Refer to the lab's printed flag instead, or describe the value neutrally.

Patient Information:
${patientInfo}

Test Results:
${testResultsSection}
${abnormalFindingsForPrompt}
${historyNote}

Respond with a JSON object (text in ${language.name}, medical terms in English):
{
  "health_status": "1-2 sentence overall status",
  "normal_findings_detailed": [
    { "test_name": "English term", "value": "value+unit", "what_it_measures": "1 sentence", "your_result_means": "1 sentence" }
  ],
  "abnormal_findings": [
    { "test_name": "English term", "value": "value+unit", "status": "high|low|critical|abnormal", "what_it_measures": "1 sentence", "explanation": "1 short sentence, 12 words or fewer", "what_to_do": "1 short question the patient can ask their clinician", "trend": "improving|worsening|stable|new" }
  ],
  "needs_consultation": true|false,
  "consultation_recommendation": "1 sentence",
  "health_tips": ["tip1", "tip2", "tip3"],
  "summary_message": "1-2 sentence warm closing",
  "language": "${language.code}"
}

Rules:
1. Medical terms must stay in English for accuracy.
2. Explanations must be in ${language.name}.
3. Use separate arrays for normal and abnormal findings.
4. Include what each finding measures and what the patient's result means.
5. Give practical health tips personalized to the available results.
6. Keep the tone warm and reassuring.
7. Do not invent diagnoses, medicines, symptoms, procedures, or values.
8. If data is missing, say it is not available instead of guessing.
9. Do not end explanations with "discuss with your clinician"; the report collects the what_to_do questions into one section.
10. Describe HbA1c strictly by ADA bands: below 5.7% normal, 5.7-6.4% in the prediabetes range, 6.5%+ in the diabetes range. Never call a value of 5.7% or above "non-diabetic" or "excellent control".

Return ONLY the JSON object, no additional text.
`;
}

function buildFallbackReport(input: GenerateRequest): ExtractedReport {
  return {
    patient: {
      name: input.patient_name,
      report_date: new Date().toISOString().slice(0, 10),
    },
    lab_info: {},
    test_sections: [
      {
        section_name: 'Uploaded Reports',
        category: 'Source Files',
        tests: input.uploaded_report_urls.map((url, index) => ({
          test_name: `Uploaded file ${index + 1}`,
          value: url,
          unit: '',
          reference_range: 'not available',
          source_flag: null,
          is_abnormal: false,
          abnormal_direction: null,
        })),
      },
    ],
    abnormal_summary: [],
  };
}

// Map of common test name variations to standardized keys
const TEST_NAME_MAP: Record<string, keyof ExtractedLabValues> = {
  // Hematology
  'hemoglobin': 'hemoglobin', 'haemoglobin': 'hemoglobin', 'hb': 'hemoglobin', 'hgb': 'hemoglobin',
  'rbc': 'rbc', 'rbc count': 'rbc', 'red blood cell': 'rbc', 'red blood cells': 'rbc', 'red blood cell count': 'rbc', 'red blood corpuscles': 'rbc',
  'wbc': 'wbc', 'wbc count': 'wbc', 'white blood cell': 'wbc', 'white blood cells': 'wbc', 'tlc': 'wbc', 'total leucocyte count': 'wbc',
  'platelet': 'platelets', 'platelets': 'platelets', 'platelet count': 'platelets', 'plt': 'platelets',
  'mcv': 'mcv', 'mean corpuscular volume': 'mcv',
  'mch': 'mch', 'mean corpuscular hemoglobin': 'mch',
  'mchc': 'mchc', 'mean corpuscular hemoglobin concentration': 'mchc',
  'rdw': 'rdw', 'rdw-cv': 'rdw', 'red cell distribution width': 'rdw',
  'neutrophil': 'neutrophils', 'neutrophils': 'neutrophils', 'neutrophil count': 'neutrophils', 'neut': 'neutrophils', 'neutrophils %': 'neutrophils', 'neutrophils absolute': 'neutrophils', 'granulocyte': 'neutrophils', 'granulocytes': 'neutrophils', 'granulocyte absolute': 'neutrophils', 'granulocytes absolute': 'neutrophils', 'granulocyte count': 'neutrophils',
  'lymphocyte': 'lymphocytes', 'lymphocytes': 'lymphocytes', 'lymphocyte count': 'lymphocytes', 'lymph': 'lymphocytes', 'lymphocytes %': 'lymphocytes', 'lymphocytes absolute': 'lymphocytes', 'lymphocytes abs': 'lymphocytes', 'lymphocyte absolute': 'lymphocytes',
  'monocyte': 'monocytes', 'monocytes': 'monocytes', 'mono': 'monocytes',
  'eosinophil': 'eosinophils', 'eosinophils': 'eosinophils', 'eos': 'eosinophils',
  'basophil': 'basophils', 'basophils': 'basophils', 'baso': 'basophils',
  'hematocrit': 'hematocrit', 'hct': 'hematocrit', 'pcv': 'hematocrit', 'packed cell volume': 'hematocrit',

  // Renal
  'creatinine': 'creatinine', 'serum creatinine': 'creatinine', 's. creatinine': 'creatinine', 'creat': 'creatinine',
  'bun': 'bun', 'blood urea nitrogen': 'bun',
  'urea': 'urea', 'blood urea': 'urea', 's. urea': 'urea',
  'uric acid': 'uric_acid', 's. uric acid': 'uric_acid', 'serum uric acid': 'uric_acid',

  // Liver
  'ast': 'ast', 'sgot': 'ast', 'aspartate aminotransferase': 'ast', 'aspartate transaminase': 'ast',
  'alt': 'alt', 'sgpt': 'alt', 'alanine aminotransferase': 'alt', 'alanine transaminase': 'alt',
  'alp': 'alp', 'alkaline phosphatase': 'alp', 'alk phos': 'alp',
  'ggt': 'ggt', 'gamma gt': 'ggt', 'gamma-glutamyl transferase': 'ggt', 'ggtp': 'ggt',
  'bilirubin total': 'bilirubin_total', 'total bilirubin': 'bilirubin_total', 's. bilirubin total': 'bilirubin_total', 'bilirubin': 'bilirubin_total',
  'bilirubin direct': 'bilirubin_direct', 'direct bilirubin': 'bilirubin_direct', 'conjugated bilirubin': 'bilirubin_direct',
  'albumin': 'albumin', 'serum albumin': 'albumin', 's. albumin': 'albumin',
  'total protein': 'total_protein', 'serum protein': 'total_protein', 's. protein': 'total_protein', 'protein total': 'total_protein',

  // Lipids
  'total cholesterol': 'total_cholesterol', 'cholesterol': 'total_cholesterol', 'cholesterol total': 'total_cholesterol', 's. cholesterol': 'total_cholesterol',
  'hdl': 'hdl', 'hdl cholesterol': 'hdl', 'hdl-c': 'hdl', 'hdl-cholesterol': 'hdl',
  'ldl': 'ldl', 'ldl cholesterol': 'ldl', 'ldl-c': 'ldl', 'ldl-cholesterol': 'ldl', 'ldl cholesterol direct': 'ldl',
  'vldl': 'vldl', 'vldl cholesterol': 'vldl', 'vldl-c': 'vldl',
  'triglyceride': 'triglycerides', 'triglycerides': 'triglycerides', 'tg': 'triglycerides', 'trigs': 'triglycerides',

  // Metabolic
  'fasting glucose': 'fasting_glucose', 'fasting blood sugar': 'fasting_glucose', 'fbs': 'fasting_glucose', 'glucose fasting': 'fasting_glucose', 'fasting plasma glucose': 'fasting_glucose',
  'random glucose': 'random_glucose', 'random blood sugar': 'random_glucose', 'rbs': 'random_glucose', 'glucose random': 'random_glucose',
  'hba1c': 'hba1c', 'glycated hemoglobin': 'hba1c', 'glycosylated hemoglobin': 'hba1c', 'a1c': 'hba1c', 'hemoglobin a1c': 'hba1c',
  'insulin': 'insulin', 'fasting insulin': 'insulin', 's. insulin': 'insulin',

  // Iron Studies
  'iron': 'iron', 'serum iron': 'iron', 's. iron': 'iron',
  'ferritin': 'ferritin', 'serum ferritin': 'ferritin', 's. ferritin': 'ferritin',
  'tibc': 'tibc', 'total iron binding capacity': 'tibc',
  'transferrin saturation': 'transferrin_saturation', 'transferrin sat': 'transferrin_saturation', 'tsat': 'transferrin_saturation',

  // Vitamins
  'vitamin d': 'vitamin_d', 'vit d': 'vitamin_d', '25-oh vitamin d': 'vitamin_d', '25-hydroxy vitamin d': 'vitamin_d', 'vitamin d3': 'vitamin_d', 'vit d3': 'vitamin_d',
  'vitamin b12': 'vitamin_b12', 'vit b12': 'vitamin_b12', 'b12': 'vitamin_b12', 'cyanocobalamin': 'vitamin_b12',
  'folate': 'folate', 'folic acid': 'folate', 'serum folate': 'folate',

  // Minerals
  'calcium': 'calcium', 'serum calcium': 'calcium', 's. calcium': 'calcium', 'total calcium': 'calcium',
  'phosphorus': 'phosphorus', 'serum phosphorus': 'phosphorus', 's. phosphorus': 'phosphorus', 'phosphate': 'phosphorus', 'inorganic phosphorus': 'phosphorus',
  'magnesium': 'magnesium', 'serum magnesium': 'magnesium', 's. magnesium': 'magnesium',
  'sodium': 'sodium', 'serum sodium': 'sodium', 's. sodium': 'sodium', 'na': 'sodium',
  'potassium': 'potassium', 'serum potassium': 'potassium', 's. potassium': 'potassium', 'k': 'potassium',
  'chloride': 'chloride', 'serum chloride': 'chloride', 's. chloride': 'chloride', 'cl': 'chloride',

  // Inflammatory
  'crp': 'crp', 'c-reactive protein': 'crp', 'hs-crp': 'crp', 'high sensitivity crp': 'crp',
  'esr': 'esr', 'erythrocyte sedimentation rate': 'esr', 'sed rate': 'esr',

  // Thyroid
  'tsh': 'tsh', 'thyroid stimulating hormone': 'tsh', 's. tsh': 'tsh',
  't3': 't3', 'total t3': 't3', 'triiodothyronine': 't3',
  't4': 't4', 'total t4': 't4', 'thyroxine': 't4',
  'free t3': 'free_t3', 'ft3': 'free_t3',
  'free t4': 'free_t4', 'ft4': 'free_t4',
};

const DERIVED_OR_DISPLAY_ONLY_TESTS = new Set([
  'total cholesterol hdl ratio',
  'ldl hdl ratio',
]);

/**
 * Rows the lab derives from other rows (ratios, indices, eAG, eGFR). Mapping
 * one of these onto a primary analyte poisons every downstream calculation:
 * "BUN/Creatinine Ratio 9.34" once overwrote creatinine 0.90 and produced an
 * eGFR of 5 / CKD Stage 5 on a patient with normal kidney function.
 */
const DERIVED_ROW_PATTERN = /\bratio\b|\bindex\b|\beag\b|estimated average|non[\s-]?hdl|\begfr\b|\bckd\b/i;

function looksDerivedOrCalculated(testName: string): boolean {
  return DERIVED_ROW_PATTERN.test(testName || '');
}

function normalizeTestNameForMapping(name: string) {
  return name
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[,+:;/\\|-]/g, ' ')
    .replace(/\bserum\b/g, ' ')
    .replace(/\bs\b/g, ' ')
    .replace(/\bdirect\b/g, ' ')
    .replace(/\bcount\b/g, ' count ')
    .replace(/\babs\b/g, ' absolute ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveLabValueKey(testName: string): keyof ExtractedLabValues | undefined {
  if (looksDerivedOrCalculated(testName)) return undefined;
  const normalized = normalizeTestNameForMapping(testName);
  if (!normalized || DERIVED_OR_DISPLAY_ONLY_TESTS.has(normalized)) return undefined;

  const candidates = [
    testName.toLowerCase().trim(),
    normalized,
    normalized.replace(/\babsolute\b/g, '').replace(/\s+/g, ' ').trim(),
    normalized.replace(/\bcount\b/g, '').replace(/\s+/g, ' ').trim(),
  ];

  for (const candidate of candidates) {
    const key = TEST_NAME_MAP[candidate];
    if (key) return key;
  }

  if (normalized.includes('creatinine')) return 'creatinine';
  if (normalized.includes('total cholesterol')) return 'total_cholesterol';
  if (/\bhdl\b/.test(normalized)) return 'hdl';
  if (/\bldl\b/.test(normalized)) return 'ldl';
  if (/\bvldl\b/.test(normalized)) return 'vldl';
  if (normalized.includes('triglyceride') || /\btg\b/.test(normalized)) return 'triglycerides';
  if (normalized.includes('granulocyte')) return 'neutrophils';
  if (normalized.includes('lymphocyte')) return 'lymphocytes';
  if (/\brbc\b/.test(normalized)) return 'rbc';
  if (/\bwbc\b/.test(normalized)) return 'wbc';
  if (normalized.includes('red blood cell')) return 'rbc';
  if (normalized.includes('white blood cell')) return 'wbc';
  if (normalized.includes('platelet')) return 'platelets';
  if (normalized.includes('corpuscular volume')) return 'mcv';
  if (normalized.includes('corpuscular hemoglobin concentration')) return 'mchc';
  if (normalized.includes('corpuscular hemoglobin')) return 'mch';
  // "ESR - After two hours" and "25 - HYDROXY VITAMIN - D" normalise to
  // spellings the alias table does not hold (its vitamin-D aliases carry
  // hyphens, which normalisation strips, so they can never match).
  if (/\besr\b/.test(normalized) || normalized.includes('sedimentation')) return 'esr';
  if (normalized.includes('hydroxy vitamin d')) return 'vitamin_d';

  return undefined;
}

function extractNumericValue(value: string): number | undefined {
  const cleaned = value.replace(/,/g, '').replace(/[<>]/g, '').trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;

  const parsed = parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const DIFFERENTIAL_KEYS = ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils'] as const;

/**
 * Physiologically plausible bounds per analyte, in the units the calculation
 * module expects (counts in 10^3/uL after normalization). A value outside its
 * bound is dropped so the dependent index reports "not calculated" instead of
 * shipping a nonsense number to a patient.
 */
const PLAUSIBLE_RANGES: Partial<Record<keyof ExtractedLabValues, [number, number]>> = {
  hemoglobin: [2, 25],
  rbc: [1, 10],
  wbc: [0.5, 200],
  platelets: [5, 2000],
  mcv: [50, 140],
  mch: [10, 50],
  mchc: [20, 45],
  hematocrit: [10, 70],
  neutrophils: [0.1, 50],
  lymphocytes: [0.1, 50],
  monocytes: [0.01, 10],
  eosinophils: [0.01, 10],
  basophils: [0, 5],
  creatinine: [0.1, 25],
  bun: [1, 200],
  urea: [2, 400],
  uric_acid: [0.5, 25],
  ast: [1, 5000],
  alt: [1, 5000],
  alp: [5, 3000],
  albumin: [1, 6.5],
  total_protein: [3, 12],
  total_cholesterol: [50, 600],
  hdl: [10, 150],
  ldl: [10, 400],
  vldl: [2, 150],
  triglycerides: [10, 3000],
  fasting_glucose: [30, 700],
  hba1c: [3, 20],
  iron: [5, 500],
  ferritin: [1, 10000],
  vitamin_d: [3, 200],
  vitamin_b12: [50, 5000],
  tsh: [0.01, 150],
  crp: [0, 400],
  esr: [0, 160],
  age: [1, 120],
};

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Brings extracted counts into the units the clinical calculations expect and
 * drops implausible values. Indian lab reports usually print platelets and WBC
 * per uL/cmm (e.g. 3,63,000) and the differential as percentages; PLR, SII,
 * and FIB-4 need absolute counts in 10^3/uL. Feeding percentages and raw
 * counts straight in once produced PLR 7,563 and SII 325,188.
 */
function normalizeLabValues(
  lab: ExtractedLabValues,
  units: Partial<Record<keyof ExtractedLabValues, string>>,
): void {
  const writable = lab as Record<string, number | string | undefined>;

  // WBC per uL, needed to convert differential percentages to absolute counts.
  const wbcRaw = typeof lab.wbc === 'number' ? lab.wbc : undefined;
  const wbcPerUl = wbcRaw !== undefined ? (wbcRaw > 1000 ? wbcRaw : wbcRaw * 1000) : undefined;

  // Platelets and WBC: raw per-uL counts -> 10^3/uL.
  if (typeof lab.platelets === 'number' && lab.platelets > 10000) {
    writable.platelets = roundTo(lab.platelets / 1000);
  }
  if (wbcRaw !== undefined && wbcRaw > 1000) {
    writable.wbc = roundTo(wbcRaw / 1000);
  }

  for (const key of DIFFERENTIAL_KEYS) {
    const value = lab[key];
    if (typeof value !== 'number') continue;
    const unit = (units[key] || '').toLowerCase();
    const explicitlyAbsolute = unit.includes('10') || unit.includes('abs') || /\bc?u?mm\b|\bul\b|\u00b5l/.test(unit);
    const isPercent = unit.includes('%') || (!explicitlyAbsolute && value <= 100);

    if (isPercent) {
      if (wbcPerUl !== undefined) {
        writable[key] = roundTo((wbcPerUl * value) / 100 / 1000);
      } else {
        // A percentage without a usable WBC count cannot become an absolute
        // count; drop it rather than let PLR/SII divide by a percentage.
        console.warn(`[generate-pathology-infographic] Dropping ${key}=${value}%: no WBC count to convert against`);
        delete writable[key];
      }
    } else if (value > 100) {
      writable[key] = roundTo(value / 1000);
    }
  }

  for (const [key, bounds] of Object.entries(PLAUSIBLE_RANGES) as Array<[keyof ExtractedLabValues, [number, number]]>) {
    const value = lab[key];
    if (typeof value !== 'number') continue;
    if (value < bounds[0] || value > bounds[1]) {
      console.warn(`[generate-pathology-infographic] Dropping implausible ${key}=${value} (plausible ${bounds[0]}-${bounds[1]})`);
      delete writable[key];
    }
  }
}

function extractLabValuesFromReport(data: ExtractedReport): ExtractedLabValues {
  const labValues: ExtractedLabValues = {};

  // Extract age and sex from patient info
  if (data.patient?.age) {
    const ageMatch = data.patient.age.match(/(\d+)/);
    if (ageMatch) {
      labValues.age = parseInt(ageMatch[1], 10);
    }
  }

  if (data.patient?.sex) {
    const sex = data.patient.sex.toLowerCase();
    if (sex.includes('male') && !sex.includes('female')) {
      labValues.sex = 'Male';
    } else if (sex.includes('female')) {
      labValues.sex = 'Female';
    }
  }

  // Extract values from test sections
  let aiMappedCount = 0;
  let fallbackMappedCount = 0;
  let unmappedNumericCount = 0;
  const mappedBy: Partial<Record<keyof ExtractedLabValues, 'ai' | 'fallback'>> = {};
  const unitByKey: Partial<Record<keyof ExtractedLabValues, string>> = {};

  for (const section of data.test_sections || []) {
    for (const test of section.tests || []) {
      // A derived row (ratio, index, eAG...) never supplies a primary value,
      // even when the extraction model assigned it a canonical_key.
      const derivedRow = looksDerivedOrCalculated(test.test_name);
      const aiCanonicalKey = !derivedRow && typeof test.canonical_key === 'string' && CANONICAL_LAB_KEY_SET.has(test.canonical_key)
        ? test.canonical_key as keyof ExtractedLabValues
        : undefined;
      const fallbackKey = aiCanonicalKey || derivedRow ? undefined : resolveLabValueKey(test.test_name);
      const mappedKey = aiCanonicalKey || fallbackKey;

      if (mappedKey && test.value) {
        const numValue = extractNumericValue(test.value);
        if (numValue !== undefined) {
          const tier = aiCanonicalKey ? 'ai' : 'fallback';
          const existingTier = mappedBy[mappedKey];
          // First value wins within a tier (labs print the primary analyte
          // before repeats and dilutions); an AI mapping outranks a fallback.
          if (!existingTier || (existingTier === 'fallback' && tier === 'ai')) {
            (labValues as Record<string, number | string>)[mappedKey] = numValue;
            mappedBy[mappedKey] = tier;
            if (test.unit) unitByKey[mappedKey] = test.unit;
            if (tier === 'ai') {
              aiMappedCount++;
            } else {
              fallbackMappedCount++;
            }
          }
        }
      } else if (test.value && extractNumericValue(test.value) !== undefined) {
        unmappedNumericCount++;
      }
    }
  }

  normalizeLabValues(labValues, unitByKey);

  (labValues as ExtractedLabValues & {
    __mapping_stats?: {
      ai_mapped_count: number;
      fallback_mapped_count: number;
      unmapped_numeric_count: number;
    };
  }).__mapping_stats = {
    ai_mapped_count: aiMappedCount,
    fallback_mapped_count: fallbackMappedCount,
    unmapped_numeric_count: unmappedNumericCount,
  };

  return labValues;
}

async function extractWithClaude(pdfBuffers: ArrayBuffer[]): Promise<ExtractedReport> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret');

  const documentParts = pdfBuffers.map((buffer) => ({
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: arrayBufferToBase64(buffer),
    },
  }));

  const response = await runtimeFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: getPositiveIntegerEnv('ANTHROPIC_EXTRACTION_MAX_TOKENS', DEFAULT_EXTRACTION_MAX_TOKENS),
      messages: [
        {
          role: 'user',
          content: [
            ...documentParts,
            { type: 'text', text: PDF_EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.content?.find((part: { type: string }) => part.type === 'text')?.text || '';
  return extractJson(text);
}

async function generatePatientSummaryWithClaude(data: ExtractedReport, input: GenerateRequest): Promise<PatientSummary> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret');

  const response = await runtimeFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: getPositiveIntegerEnv('ANTHROPIC_SUMMARY_MAX_TOKENS', DEFAULT_SUMMARY_MAX_TOKENS),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildPatientSummaryPrompt(data, input),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic summary API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.content?.find((part: { type: string }) => part.type === 'text')?.text || '';
  return parseJsonObject<PatientSummary>(text);
}

interface CalculationsResult {
  individual_indices: CalculatedIndex[];
  not_calculated_indices: CalculatedIndex[];
  composite_scores: CompositeScore[];
}

function buildLayoutPrompt(data: ExtractedReport, input: GenerateRequest, calculations?: CalculationsResult) {
  const sections = data.test_sections || [];
  const abnormals = data.abnormal_summary || [];
  const patient = data.patient || {};
  const lab = data.lab_info || {};
  const summary = data.patient_summary || null;
  const language = getTargetLanguage(input.summary_language);

  const lines: string[] = [
    '# SMART REPORT LAYOUT',
    '',
    '## Content Grounding Rules',
    'Use only the patient data, test values, units, reference ranges, dates, lab details, and trend data included below.',
    'Do not add diagnoses, symptoms, medications, lifestyle advice, procedures, or biomarkers that are not present in the data.',
    'Do not omit any lab value listed under "Complete Lab Values". Present every test row in the final report.',
    'Use patient-friendly clinical language. Avoid marketing phrases such as "excellent health profile", "perfectly healthy", "world-class", or "complete transformation".',
    'If a value or comparison is missing, write "not available" instead of guessing.',
    'Keep the report compact: use tables for values and short callouts for interpretation.',
    '',
    '---',
    '',
    '## Page Header',
    `Patient: ${patient.name || input.patient_name || 'not available'}`,
    `Age/Sex: ${patient.age || 'not available'} / ${patient.sex || 'not available'}`,
    `Report Date: ${patient.report_date || 'not available'}`,
    `Lab: ${lab.name || 'not available'}`,
    `Report Type: ${input.report_type}`,
    `Summary Language: ${language.name}`,
    input.notes ? `Request Notes: ${input.notes}` : '',
    '',
    '---',
  ].filter(Boolean);

  if (summary) {
    lines.push(
      '',
      `## Patient Summary (${language.name})`,
      'Use this as a short summary block, not as repeated long paragraphs.',
      summary.health_status ? `Overall Status: ${summary.health_status}` : '',
      summary.summary_message ? `Message: ${summary.summary_message}` : '',
      `Needs Consultation: ${summary.needs_consultation ? 'Yes' : 'No'}`,
      summary.consultation_recommendation ? `Consultation Recommendation: ${summary.consultation_recommendation}` : '',
      '',
      '### Abnormal Findings Explained (brief callouts)',
    );

    if (summary.abnormal_findings?.length) {
      summary.abnormal_findings.forEach((item) => {
        lines.push(`- ${item.test_name}: ${item.value} [${item.status}] - ${item.explanation}`);
        lines.push(`  Discuss: ${item.what_to_do}`);
      });
    } else {
      lines.push('- No abnormal findings were explained from the extracted data.');
    }

    lines.push('', '### Normal Findings Summary');
    if (summary.normal_findings_detailed?.length) {
      summary.normal_findings_detailed.slice(0, 5).forEach((item) => {
        lines.push(`- ${item.test_name}: ${item.value} - ${item.your_result_means}`);
      });
    } else {
      lines.push('- Normal findings summary not available.');
    }

    if (summary.health_tips?.length) {
      lines.push('', '### Grounded Health Tips', ...summary.health_tips.slice(0, 3).map((tip) => `- ${tip}`));
    }

    lines.push('', '---');
  }

  if (abnormals.length > 0) {
    lines.push('', '## Abnormal Values Summary', 'Layout: Compact alert cards with clear HIGH/LOW labels', '');
    for (const item of abnormals) {
      lines.push(`- ${item.section}: ${item.test_name} ${item.value} [${item.direction.toUpperCase()}] (Ref: ${item.reference_range || 'not available'})`);
    }
    lines.push('', '---');
  } else {
    lines.push('', '## Results Within Provided Reference Ranges', 'All extracted test values are within the provided reference ranges. Do not describe the patient as perfectly healthy.', '', '---');
  }

  lines.push(
    '',
    '## Complete Lab Values',
    'Layout: Compact tables grouped by section. This section is mandatory and must include every test row below.',
    'Flag column rule: use only compact source flags printed in the uploaded report (N/H/L/C). Leave the flag blank when the source report did not print a flag for that test. Do not generate flags from reference ranges.',
    ''
  );

  const sourceFlags = new Set<string>();
  sections.forEach((section, index) => {
    lines.push('', `### ${section.section_name || `Section ${index + 1}`}`, 'Table Columns: Test | Result | Unit | Flag | Reference Range', `Category: ${section.category || 'not available'}`, '');
    for (const test of section.tests || []) {
      const flag = compactSourceFlag(test.source_flag);
      if (flag) sourceFlags.add(flag);
      lines.push(`- ${test.test_name} | ${test.value} | ${test.unit || 'not available'} | ${flag} | ${test.reference_range || 'not available'}`);
    }
  });
  const sourceFlagLegend = buildSourceFlagLegend(sourceFlags);
  if (sourceFlagLegend) lines.push('', sourceFlagLegend);
  lines.push('', '---');

  // Add Clinical Calculations Section (for longevity reports or when calculations are available)
  if (calculations && (calculations.individual_indices.length > 0 || calculations.composite_scores.length > 0)) {
    lines.push('', '## Clinical Calculations & Health Indices');
    lines.push('Layout: Health Dashboard with Score Cards');
    lines.push('');

    // Add individual calculated indices
    if (calculations.individual_indices.length > 0) {
      lines.push('### Calculated Clinical Indices');
      lines.push('');

      // Group by category
      const byCategory: Record<string, CalculatedIndex[]> = {};
      for (const idx of calculations.individual_indices) {
        if (!byCategory[idx.category]) {
          byCategory[idx.category] = [];
        }
        byCategory[idx.category].push(idx);
      }

      for (const [category, indices] of Object.entries(byCategory)) {
        lines.push(`**${category}**`);
        for (const idx of indices) {
          const statusIcon = idx.status === 'optimal' ? '✓' : idx.status === 'borderline' ? '⚠' : idx.status === 'high' || idx.status === 'low' ? '!' : '';
          lines.push(`- ${idx.name}: ${idx.value}${idx.unit ? ' ' + idx.unit : ''} ${statusIcon}`);
          lines.push(`  ${idx.interpretation}`);
          if (idx.reference_range) {
            lines.push(`  Reference: ${idx.reference_range}`);
          }
        }
        lines.push('');
      }
      lines.push('---');
    }

    // Add composite health scores (especially for longevity reports)
    if (calculations.composite_scores.length > 0) {
      lines.push('');
      lines.push('### Composite Health Scores');
      lines.push('Layout: Score Cards with Grades A-F');
      lines.push('');

      for (const score of calculations.composite_scores) {
        lines.push(`**${score.emoji} ${score.name}: ${score.score}/100 (Grade ${score.grade})**`);
        lines.push(`  ${score.interpretation}`);
        if (score.factors_used.length > 0) {
          lines.push(`  Based on: ${score.factors_used.slice(0, 6).join(', ')}${score.factors_used.length > 6 ? '...' : ''}`);
        }
        if (score.recommendations.length > 0) {
          lines.push(`  Recommendations:`);
          for (const rec of score.recommendations.slice(0, 2)) {
            lines.push(`    • ${rec}`);
          }
        }
        lines.push('');
      }
      lines.push('---');
    }
  }

  return lines.join('\n');
}

type TestClassification = 'high' | 'low' | 'critical' | 'normal' | 'unclassified';

/**
 * Placeholders labs print where no range exists. "N/A" slipping through
 * meant a qualitative HIV result rendered as a full table row with an empty
 * position bar while HBsAG, identical in kind, collapsed into the
 * descriptive list.
 */
const NO_RANGE_PLACEHOLDERS = new Set(['not available', 'n/a', 'na', 'nil', '-', '--', '\u2014']);

function hasUsableRange(range?: string): boolean {
  const text = (range || '').trim().toLowerCase();
  return Boolean(text) && !NO_RANGE_PLACEHOLDERS.has(text);
}

/**
 * Classification used for all counts, scorecards, and abnormal cards.
 * A value with no printed reference range and no printed source flag is
 * "unclassified": it is never presented as outside the normal range.
 */
function classifyTest(test: ExtractedTest): TestClassification {
  const flag = compactSourceFlag(test.source_flag);
  if (flag === 'C') return 'critical';
  if (flag === 'H') return 'high';
  if (flag === 'L') return 'low';
  const rangeAvailable = hasUsableRange(test.reference_range);
  if (test.is_abnormal && rangeAvailable) {
    return test.abnormal_direction === 'low' ? 'low' : 'high';
  }
  if (flag === 'N' || rangeAvailable) return 'normal';
  return 'unclassified';
}

function parseNumericValue(value?: string): number | null {
  const match = (value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Picks the segment of a reference range that applies to this patient.
 *
 * Labs commonly print both sexes in one string - "M : 14 - 18 / F : 12 - 16
 * g/dl" - and taking the first numeric pair silently compares a woman
 * against the male range. For an 11.5 g/dL haemoglobin that is the
 * difference between "below 12" and "below 14", so the chart disagreed with
 * the table. Returns the whole string when no sex-specific split is found.
 */
function sexSpecificRangeSegment(text: string, sex?: string): string {
  const initial = (sex || '').trim().toUpperCase().charAt(0);
  if (initial !== 'M' && initial !== 'F') return text;
  if (!/\b[MF]\s*[:=-]/i.test(text)) return text;
  // Split immediately before each "M :" / "F :" marker rather than on
  // punctuation: separators vary ("M : 14 - 18 / F : 12 - 16" but also
  // "M : 7 - 15 , F : 10 - 18"), and stripping thousands commas earlier had
  // already removed the only separator in the second form.
  const parts = text.split(/(?=\b[MF]\s*[:=-])/i);
  for (const part of parts) {
    const m = part.match(/^\s*([MF])\s*[:=-]\s*(.+)$/i);
    if (m && m[1].toUpperCase() === initial) return m[2];
  }
  return text;
}

export function parseReferenceBounds(range?: string, sex?: string): { low?: number; high?: number } | null {
  if (!hasUsableRange(range)) return null;
  // Pick the sex-specific segment BEFORE stripping commas - the comma is
  // sometimes the separator between the two sexes' ranges.
  const text = sexSpecificRangeSegment((range || '').trim(), sex).replace(/,/g, '').trim();

  // Multi-zone categorical ranges ("< 100 : Optimal / 100 - 129 : Near
  // Optimal / ...") name each zone. The first numeric pair in the text is
  // whichever zone the lab listed first - for LDL that is Near Optimal, and
  // a chart drawn against it paints an optimal value as outside its own
  // band. Prefer the zone whose label says it is the target.
  const segments = text.split('/');
  if (segments.length > 1) {
    const target = segments.find((seg) =>
      /optimal|desirable|normal|sufficien|non.?diabetic/i.test(seg)
      && !/near|above|border|insufficien|unsatisfactory|poor/i.test(seg));
    if (target) {
      const bounds = boundsFromRangeText(target.trim());
      if (bounds) return bounds;
    }
  }
  return boundsFromRangeText(text);
}

function boundsFromRangeText(text: string): { low?: number; high?: number } | null {
  let match = text.match(/(-?\d+(?:\.\d+)?)\s*(?:-|\u2013|\u2014|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return { low: Number(match[1]), high: Number(match[2]) };
  match = text.match(/^[^0-9<>]*(?:<|\u2264|<=|up to)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return { high: Number(match[1]) };
  match = text.match(/^[^0-9<>]*(?:>|\u2265|>=)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return { low: Number(match[1]) };
  return null;
}

/** Markers worth a value-vs-range bar when both the value and range are numeric. */
const KEY_MARKER_KEYS = new Set<string>([
  'hemoglobin', 'iron', 'ferritin', 'vitamin_d', 'vitamin_b12',
  'total_cholesterol', 'ldl', 'hdl', 'triglycerides',
  'hba1c', 'fasting_glucose', 'tsh', 'creatinine', 'crp',
]);

function sectionAccent(flaggedCount: number, hasCritical: boolean): 'green' | 'amber' | 'red' {
  if (hasCritical || flaggedCount >= 3) return 'red';
  if (flaggedCount > 0) return 'amber';
  return 'green';
}

function buildCompactLayoutPrompt(data: ExtractedReport, input: GenerateRequest, calculations?: CalculationsResult) {
  const sections = data.test_sections || [];
  const patient = data.patient || {};
  const lab = data.lab_info || {};
  const summary = data.patient_summary || null;
  const language = getTargetLanguage(input.summary_language);

  // Classify every row in code so Gamma never counts or re-flags anything.
  const classified: Array<{ section: string; test: ExtractedTest; cls: TestClassification }> = [];
  sections.forEach((section, index) => {
    const name = section.section_name || `Section ${index + 1}`;
    for (const test of section.tests || []) {
      classified.push({ section: name, test, cls: classifyTest(test) });
    }
  });

  const counts = { total: classified.length, normal: 0, high: 0, low: 0, critical: 0, unclassified: 0 };
  for (const row of classified) {
    if (row.cls === 'normal') counts.normal++;
    else if (row.cls === 'high') counts.high++;
    else if (row.cls === 'low') counts.low++;
    else if (row.cls === 'critical') counts.critical++;
    else counts.unclassified++;
  }
  const flagged = classified.filter((row) => row.cls === 'high' || row.cls === 'low' || row.cls === 'critical');

  const noteByTest = new Map<string, { explanation?: string }>();
  for (const finding of summary?.abnormal_findings || []) {
    if (finding.test_name) noteByTest.set(finding.test_name.trim().toLowerCase(), finding);
  }

  const lines: string[] = [
    '# SMART REPORT LAYOUT',
    '',
    '## Content Grounding Rules',
    'Use only the patient data, test values, units, reference ranges, dates, lab details, calculated indices, counts, and trend data included below.',
    'Do not add diagnoses, symptoms, medications, lifestyle advice, procedures, or biomarkers that are not present in the data.',
    'Do not omit any lab value listed under "Complete Lab Values". Present every test row in the final report.',
    `Never describe a value as "not in normal range" or outside the normal range when its reference range is "not available". Cite the lab's printed flag if one exists; otherwise present the value neutrally.`,
    'All counts below are pre-computed. Use them exactly; do not recount rows.',
    'If a value or comparison is missing, write "not available" instead of guessing.',
    'Cap every interpretation at one line. Avoid marketing phrases such as "excellent health profile", "perfectly healthy", "world-class", or "complete transformation".',
    'Describe HbA1c strictly by ADA bands: below 5.7% normal, 5.7-6.4% prediabetes range, 6.5%+ diabetes range. Never call 5.7% or above "non-diabetic" or "excellent control".',
    '',
    '## Required Report Structure',
    '1. Patient header and report metadata (one compact band).',
    '2. Results dashboard: stat tiles plus the results-split chart.',
    '3. Domain scorecards, one per report section.',
    '4. Short patient summary.',
    '5. Abnormal findings as compact cards.',
    '6. Key marker charts, when data rows are provided.',
    '7. Calculated indices dashboard, when available.',
    '8. Complete Lab Values table grouped by original report section. This is mandatory.',
    '9. Questions to discuss with your clinician (single consolidated list).',
    '10. Health tips as icon cards, then a one-line footer strip with the disclaimer.',
    '',
    '## Page Header',
    'Layout: one compact metadata band, no paragraphs.',
    `Patient: ${patient.name || input.patient_name || 'not available'}`,
    `Age/Sex: ${patient.age || 'not available'} / ${patient.sex || 'not available'}`,
    `Report Date: ${patient.report_date || 'not available'}`,
    `Doctor: ${patient.doctor_name || 'not available'}`,
    `Lab: ${lab.name || 'not available'}`,
    `Report Type: ${input.report_type}`,
    `Summary Language: ${language.name}`,
    input.notes ? `Request Notes: ${input.notes}` : '',
    '',
    '---',
    '',
    '## Results Dashboard',
    'Layout: large stat tiles in one row, with a donut chart of the normal/high/low split beside them. If a donut is not possible, use a single horizontal stacked bar. Use these exact counts:',
    `- Total tests: ${counts.total}`,
    `- Normal: ${counts.normal} (green)`,
    `- High: ${counts.high} (red/amber)`,
    `- Low: ${counts.low} (red/amber)`,
    counts.critical > 0 ? `- Critical: ${counts.critical} (red)` : '',
    counts.unclassified > 0
      ? `- No range or flag printed: ${counts.unclassified} (neutral grey; these are informational values, never describe them as outside the normal range)`
      : '',
    '',
    '## Domain Scorecards',
    'Layout: one small tile per section in a grid, each showing "X flagged / Y tested" with the given accent color. A reader should spot problem areas in 3 seconds.',
  ].filter(Boolean);

  sections.forEach((section, index) => {
    const name = section.section_name || `Section ${index + 1}`;
    const rows = classified.filter((row) => row.section === name);
    const sectionFlagged = rows.filter((row) => row.cls === 'high' || row.cls === 'low' || row.cls === 'critical');
    const accent = sectionAccent(sectionFlagged.length, rows.some((row) => row.cls === 'critical'));
    lines.push(`- ${name}: ${sectionFlagged.length} flagged / ${rows.length} tested [accent: ${accent}]`);
  });
  lines.push('', '---');

  if (summary) {
    lines.push(
      '',
      `## Patient Summary (${language.name})`,
      'Layout: short callout, 3 lines maximum.',
      summary.health_status ? `Overall Status: ${summary.health_status}` : '',
      summary.summary_message ? `Message: ${summary.summary_message}` : '',
      '',
      '### Normal Findings Summary',
      'Layout: one compact two-column list, one line per item.',
    );
    if (summary.normal_findings_detailed?.length) {
      for (const item of summary.normal_findings_detailed.slice(0, 5)) {
        lines.push(`- ${item.test_name}: ${item.value} - ${item.your_result_means}`);
      }
    } else {
      lines.push('- Normal findings summary not available.');
    }
    lines.push('', '---');
  }

  if (flagged.length > 0) {
    lines.push(
      '',
      '## Abnormal Findings',
      'Layout: compact cards in a grid, 2-3 per row. Each card: test name, the value in large type, an H/L/CRITICAL pill, the reference line, and one note of 12 words or fewer. No paragraphs, and no "discuss with your clinician" on cards.',
      '',
    );
    for (const row of flagged) {
      const pill = row.cls.toUpperCase();
      const rangeAvailable = hasUsableRange(row.test.reference_range);
      const refPart = rangeAvailable
        ? `Ref: ${row.test.reference_range}`
        : `Flagged ${compactSourceFlag(row.test.source_flag) || pill} on the lab report; reference range not printed - do not say "not in normal range"`;
      const note = noteByTest.get(row.test.test_name.trim().toLowerCase())?.explanation;
      lines.push(
        `- ${row.section}: ${row.test.test_name} | ${row.test.value}${row.test.unit ? ' ' + row.test.unit : ''} | [${pill}] | ${refPart}${note ? ` | Note (trim to 12 words): ${note}` : ''}`,
      );
    }
    lines.push('', '---');
  } else {
    lines.push(
      '',
      '## Results Within Provided Reference Ranges',
      'All classified test values are within the provided reference ranges or lab flags. Do not describe the patient as perfectly healthy.',
      '',
      '---',
    );
  }

  const keyMarkers: Array<{
    row: { section: string; test: ExtractedTest; cls: TestClassification };
    numeric: number;
    bounds: { low?: number; high?: number };
  }> = [];
  for (const row of classified) {
    if (keyMarkers.length >= 8) break;
    if (!row.test.canonical_key || !KEY_MARKER_KEYS.has(String(row.test.canonical_key))) continue;
    const bounds = parseReferenceBounds(row.test.reference_range, patient.sex);
    const numeric = parseNumericValue(row.test.value);
    if (!bounds || numeric === null) continue;
    keyMarkers.push({ row, numeric, bounds });
  }
  if (keyMarkers.length > 0) {
    lines.push(
      '',
      '## Key Marker Charts',
      'Layout: one small horizontal bar per marker showing the value against its reference band. Color red/amber when flagged, green/blue when in range. If bars are not possible, use one compact highlighted table.',
      '',
    );
    for (const marker of keyMarkers) {
      const band = [
        marker.bounds.low !== undefined ? `low ${marker.bounds.low}` : '',
        marker.bounds.high !== undefined ? `high ${marker.bounds.high}` : '',
      ].filter(Boolean).join(', ');
      const status = marker.row.cls === 'normal' ? 'IN RANGE' : marker.row.cls.toUpperCase();
      lines.push(
        `- ${marker.row.test.test_name}: value ${marker.numeric}${marker.row.test.unit ? ' ' + marker.row.test.unit : ''} | reference band: ${band} (${marker.row.test.reference_range}) | status: ${status}`,
      );
    }
    lines.push('', '---');
  }

  if (calculations && calculations.composite_scores.length > 0) {
    lines.push(
      '',
      '## Composite Health Scores',
      'Layout: one gauge or large stat tile per score, with the grade as a chip. If gauges are not possible, use big stat tiles with a progress bar.',
      '',
    );
    for (const score of calculations.composite_scores) {
      lines.push(`- ${score.name}: ${score.score}/100 (Grade ${score.grade}) - ${score.interpretation}`);
      if (score.factors_used.length > 0) {
        lines.push(`  Based on: ${score.factors_used.slice(0, 6).join(', ')}${score.factors_used.length > 6 ? '...' : ''}`);
      }
    }
    lines.push('', '---');
  }

  if (calculations && calculations.individual_indices.length > 0) {
    lines.push(
      '',
      '## Clinical Calculations & Health Indices',
      'Layout: one compact table with a colored status chip per row. One short phrase per interpretation.',
      'Table Columns: Index | Value | Status | Interpretation | Reference',
      '',
    );
    for (const idx of calculations.individual_indices) {
      lines.push(`- ${idx.name} | ${idx.value}${idx.unit ? ' ' + idx.unit : ''} | ${idx.status.toUpperCase()} | ${idx.interpretation} | ${idx.reference_range || 'not available'}`);
    }
    lines.push('', '---');
  }

  lines.push(
    '',
    '## Complete Lab Values',
    'Layout: Compact tables grouped by section. Mandatory: include every test row below.',
    'Flag column rule: use only compact source flags printed in the uploaded report (N/H/L/C). Leave the flag blank when the source report did not print a flag for that test. Do not generate flags from reference ranges.',
    '',
  );

  const sourceFlags = new Set<string>();
  sections.forEach((section, index) => {
    lines.push(`### ${section.section_name || `Section ${index + 1}`}`);
    lines.push('Table Columns: Test | Result | Unit | Flag | Reference Range');
    lines.push(`Category: ${section.category || 'not available'}`);
    for (const test of section.tests || []) {
      const flag = compactSourceFlag(test.source_flag);
      if (flag) sourceFlags.add(flag);
      lines.push(`- ${test.test_name} | ${test.value} | ${test.unit || 'not available'} | ${flag} | ${test.reference_range || 'not available'}`);
    }
    lines.push('');
  });
  const sourceFlagLegend = buildSourceFlagLegend(sourceFlags);
  if (sourceFlagLegend) lines.push(sourceFlagLegend, '');

  const questions = Array.from(
    new Set((summary?.abnormal_findings || []).map((finding) => (finding.what_to_do || '').trim()).filter(Boolean)),
  ).slice(0, 6);
  if (summary?.consultation_recommendation) questions.push(summary.consultation_recommendation);
  if (questions.length > 0) {
    lines.push('', '## Questions to Discuss With Your Clinician', 'Layout: one short checklist. This is the only place clinician follow-up appears.', '');
    for (const question of questions) lines.push(`- ${question}`);
    lines.push('');
  }

  if (summary?.health_tips?.length) {
    lines.push('', '## Health Tips', 'Layout: 3 short icon cards, one line each. No paragraphs.', '');
    for (const tip of summary.health_tips.slice(0, 3)) lines.push(`- ${tip}`);
    lines.push('');
  }

  const footerParts: string[] = [];
  if (calculations && calculations.not_calculated_indices.length > 0) {
    footerParts.push(
      `Not calculated (missing inputs): ${calculations.not_calculated_indices.slice(0, 8).map((idx) => idx.name).join(', ')}.`,
    );
  }
  footerParts.push('This report is an educational summary of the uploaded lab values and is not a medical diagnosis.');
  lines.push('', '## Footer', 'Layout: one thin footer strip, small text, single line per item.', ...footerParts.map((part) => `- ${part}`), '');

  return lines.join('\n');
}

async function generateWithGamma(layoutPrompt: string): Promise<string | null> {
  const apiKey = Deno.env.get('GAMMA_API_KEY');
  if (!apiKey) return null;

  const start = await runtimeFetch('https://public-api.gamma.app/v1.0/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      accept: 'application/json',
    },
    body: JSON.stringify({
      textMode: 'generate',
      inputText: layoutPrompt,
      format: 'document',
      themeId: Deno.env.get('GAMMA_THEME_ID') || 'wbpgwj9c0ty5wbo',
      cardSplit: 'auto',
      additionalInstructions: GAMMA_INSTRUCTIONS,
      exportAs: 'pdf',
      // Without this Gamma documents default to 'fluid' - variable-height
      // pages. The letterhead path merges A4 branded pages around whatever
      // the renderer produced, so fluid pages give a document that changes
      // page size partway through. A4 keeps every renderer on one geometry.
      cardOptions: {
        dimensions: 'a4',
      },
      sharingOptions: {
        workspaceAccess: 'edit',
        externalAccess: 'view',
      },
      imageOptions: {
        source: 'noImages',
      },
    }),
  });

  if (!start.ok) {
    const text = await start.text();
    throw new Error(`Gamma API error ${start.status}: ${text}`);
  }

  const started = await start.json();
  const generationId = started.generationId || started.id;
  if (!generationId) throw new Error('Gamma did not return a generation id');

  // Gamma generations typically take 1-3 minutes; the old 120s budget gave up
  // on documents that finished moments later, silently shipping the PDFCO
  // fallback while the finished doc sat in the Gamma dashboard. 96 x 2.5s =
  // 240s, which still leaves room for branding + upload inside the worker's
  // wall-clock limit now that the pipeline runs as a background task.
  for (let attempt = 0; attempt < 96; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const poll = await runtimeFetch(`https://public-api.gamma.app/v1.0/generations/${generationId}`, {
      headers: {
        'X-API-KEY': apiKey,
        accept: 'application/json',
      },
    });
    if (!poll.ok) continue;

    const status = await poll.json();
    if (status.status === 'completed') {
      const exportUrl = status.exportUrl || status.pdfUrl || status.exportUrls?.pdf
        || status.urls?.pdf || status.fileUrl || null;
      logStage('gamma_poll_completed', {
        generation_id: generationId,
        gamma_url: status.gammaUrl || null,
        has_export_url: Boolean(exportUrl),
        status_keys: Object.keys(status),
      });
      if (!exportUrl) {
        // Completed without a recognizable export URL: log the whole payload
        // so the real field name shows up in the function logs.
        console.warn('[generate-pathology-infographic] Gamma completed without export URL:', JSON.stringify(status));
      }
      return exportUrl;
    }
    if (status.status === 'failed' || status.status === 'error') {
      throw new Error(`Gamma generation failed: ${JSON.stringify(status)}`);
    }
  }

  throw new Error(`Gamma generation timed out after 240s (generationId ${generationId}); the document may still finish in the Gamma dashboard`);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildFallbackHtml(data: ExtractedReport, input: GenerateRequest) {
  const patient = data.patient || {};
  const lab = data.lab_info || {};
  const abnormals = data.abnormal_summary || [];
  const summary = data.patient_summary || null;
  const language = getTargetLanguage(input.summary_language);

  const abnormalHtml = abnormals.length === 0
    ? '<p>All extracted test values are within the provided reference ranges. This does not mean the patient is perfectly healthy.</p>'
    : `<ul>${abnormals.map((item) => `<li><strong>${escapeHtml(item.test_name)}</strong>: ${escapeHtml(item.value)} <span class="abnormal">[${escapeHtml(item.direction.toUpperCase())}]</span> Ref: ${escapeHtml(item.reference_range || 'not available')}</li>`).join('')}</ul>`;

  const sourceFlags = new Set<string>();
  const sectionHtml = (data.test_sections || []).map((section) => `
    <section>
      <h2>${escapeHtml(section.section_name || 'Report Section')}</h2>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Value</th>
            <th>Reference Range</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          ${(section.tests || []).map((test) => {
            const flag = compactSourceFlag(test.source_flag);
            if (flag) sourceFlags.add(flag);
            return `
              <tr>
                <td>${escapeHtml(test.test_name)}</td>
                <td>${escapeHtml(`${test.value} ${test.unit || ''}`.trim())}</td>
                <td>${escapeHtml(test.reference_range || 'not available')}</td>
                <td class="${flag === 'H' || flag === 'L' || flag === 'C' ? 'abnormal' : 'normal'}">${escapeHtml(flag)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </section>
  `).join('');

  const sourceFlagLegend = buildSourceFlagLegend(sourceFlags);

  const summaryHtml = summary ? `
    <section>
      <h2>Patient Summary (${escapeHtml(language.name)})</h2>
      ${summary.health_status ? `<p><strong>Overall status:</strong> ${escapeHtml(summary.health_status)}</p>` : ''}
      ${summary.summary_message ? `<p>${escapeHtml(summary.summary_message)}</p>` : ''}
      <p><strong>Needs consultation:</strong> ${summary.needs_consultation ? 'Yes' : 'No'}</p>
      ${summary.consultation_recommendation ? `<p><strong>Recommendation:</strong> ${escapeHtml(summary.consultation_recommendation)}</p>` : ''}
      ${summary.abnormal_findings?.length ? `
        <h3>Abnormal Findings Explained</h3>
        <ul>
          ${summary.abnormal_findings.map((item) => `
            <li>
              <strong>${escapeHtml(item.test_name)}</strong>: ${escapeHtml(item.value)} <span class="abnormal">[${escapeHtml(item.status)}]</span><br />
              ${escapeHtml(item.what_it_measures)} ${escapeHtml(item.explanation)} ${escapeHtml(item.what_to_do)}
            </li>
          `).join('')}
        </ul>
      ` : ''}
      ${summary.normal_findings_detailed?.length ? `
        <h3>Normal Findings Explained</h3>
        <ul>
          ${summary.normal_findings_detailed.slice(0, 12).map((item) => `
            <li>
              <strong>${escapeHtml(item.test_name)}</strong>: ${escapeHtml(item.value)}<br />
              ${escapeHtml(item.what_it_measures)} ${escapeHtml(item.your_result_means)}
            </li>
          `).join('')}
        </ul>
      ` : ''}
      ${summary.health_tips?.length ? `
        <h3>Health Tips</h3>
        <ul>${summary.health_tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>
      ` : ''}
    </section>
  ` : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; }
    h1 { color: #253179; margin-bottom: 4px; }
    h2 { color: #253179; border-bottom: 1px solid #dbe3ff; padding-bottom: 6px; margin-top: 24px; }
    .meta { color: #4b5563; font-size: 12px; line-height: 1.5; }
    .notice { background: #fff7ed; border: 1px solid #fed7aa; color: #7c2d12; padding: 10px; border-radius: 6px; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
    h3 { color: #374151; margin-bottom: 4px; }
    li { margin-bottom: 6px; }
    th { background: #eef2ff; text-align: left; }
    th, td { border: 1px solid #d1d5db; padding: 7px; vertical-align: top; }
    .abnormal { color: #b91c1c; font-weight: 700; }
    .normal { color: #047857; font-weight: 700; }
    .footer { margin-top: 28px; color: #6b7280; font-size: 10px; }
  </style>
</head>
<body>
  <h1>Smart Pathology Report</h1>
  <div class="meta">
    <div><strong>Patient:</strong> ${escapeHtml(patient.name || input.patient_name || 'not available')}</div>
    <div><strong>Report Date:</strong> ${escapeHtml(patient.report_date || 'not available')}</div>
    <div><strong>Age/Sex:</strong> ${escapeHtml(patient.age || 'not available')} / ${escapeHtml(patient.sex || 'not available')}</div>
    <div><strong>Lab:</strong> ${escapeHtml(lab.name || 'not available')}</div>
    <div><strong>Report Type:</strong> ${escapeHtml(input.report_type)}</div>
    <div><strong>Summary Language:</strong> ${escapeHtml(language.name)}</div>
  </div>
  <div class="notice">This report summarizes extracted values only. It does not provide a diagnosis. Discuss clinical next steps with your clinician.</div>
  ${summaryHtml}
  <section>
    <h2>Abnormal Values Summary</h2>
    ${abnormalHtml}
  </section>
  ${sectionHtml}
  ${sourceFlagLegend ? `<div class="footer">${escapeHtml(sourceFlagLegend)}</div>` : ''}
  <div class="footer">Generated from uploaded source reports using grounded extraction rules. Missing or unclear values are not guessed.</div>
</body>
</html>`;
}

function isImageUrl(url: string) {
  return /\.(png|jpe?g|webp)(?:\?|#|$)/i.test(url);
}

function buildBrandedPageHtml(data: ExtractedReport, input: GenerateRequest, pageKind: 'first' | 'last') {
  const patient = data.patient || {};
  const lab = data.lab_info || {};
  const sections = data.test_sections || [];
  const language = getTargetLanguage(input.summary_language);
  const letterheadUrl = input.letterhead_url || '';
  const backgroundStyle = letterheadUrl && isImageUrl(letterheadUrl) ? `
    #page-bg {
      position: fixed;
      top: 0;
      left: 0;
      width: 210mm;
      height: 297mm;
      z-index: 0;
      background-image: url('${letterheadUrl}');
      background-size: 210mm 297mm;
      background-repeat: no-repeat;
    }
  ` : '';

  const testChips = sections.slice(0, 12).map((section) =>
    `<span class="test-chip">${escapeHtml(section.section_name || 'Report Section')}</span>`
  ).join('');

  const title = pageKind === 'first' ? 'Smart Health Report' : 'Report Closing Summary';
  const closing = pageKind === 'last'
    ? `<div class="closing-box">
        <h2>Important Note</h2>
        <p>This AI-enhanced report is a patient-friendly summary of extracted laboratory values. It is not a diagnosis. Please consult your physician for medical interpretation and treatment decisions.</p>
        <p class="warm">${escapeHtml(data.patient_summary?.summary_message || 'Thank you for trusting us with your health report.')}</p>
      </div>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; width: 210mm; min-height: 297mm; font-family: Arial, sans-serif; color: #1f2937; }
    ${backgroundStyle}
    .cover-page { position: relative; z-index: 1; padding: 42px; padding-top: ${letterheadUrl ? '250px' : '42px'}; padding-bottom: ${letterheadUrl ? '140px' : '42px'}; min-height: 297mm; box-sizing: border-box; }
    .lab-section { margin-bottom: 28px; display: ${letterheadUrl ? 'none' : 'block'}; }
    .lab-name { font-size: 26px; font-weight: 700; color: #1e40af; }
    .lab-contact { color: #475569; font-size: 12px; margin-top: 4px; }
    .report-title { margin: 28px 0; }
    h1 { font-size: 34px; color: #1f2937; margin: 0 0 10px; }
    h2 { color: #1e40af; margin-top: 0; }
    .smart-badge { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 8px 20px; border-radius: 25px; display: inline-block; font-size: 13px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 24px; }
    .info-card { background: rgba(248,250,252,0.96); border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; }
    .info-row { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e5e7eb; padding: 8px 0; font-size: 12px; }
    .info-row span:first-child { color: #64748b; }
    .info-row span:last-child { font-weight: 600; text-align: right; }
    .test-scope { margin-top: 28px; background: rgba(255,255,255,0.94); border: 1px solid #dbeafe; border-radius: 10px; padding: 18px; }
    .test-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .test-chip { background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #93c5fd; padding: 8px 12px; border-radius: 8px; font-size: 11px; }
    .closing-box { margin-top: 40px; background: rgba(255,255,255,0.95); border: 1px solid #bfdbfe; border-radius: 12px; padding: 24px; line-height: 1.55; }
    .warm { font-weight: 600; color: #1e40af; }
    .disclaimer { position: absolute; bottom: 42px; left: 42px; right: 42px; color: #64748b; font-size: 11px; text-align: center; }
  </style>
</head>
<body>
  ${letterheadUrl && isImageUrl(letterheadUrl) ? '<div id="page-bg"></div>' : ''}
  <div class="cover-page">
    <div class="lab-section">
      <div class="lab-name">${escapeHtml(lab.name || 'Laboratory')}</div>
      <div class="lab-contact">${escapeHtml([lab.address, lab.phone].filter(Boolean).join(' | ') || 'Lab details not available')}</div>
    </div>
    <div class="report-title">
      <h1>${escapeHtml(title)}</h1>
      <span class="smart-badge">AI Enhanced Analysis</span>
    </div>
    <div class="info-grid">
      <div class="info-card">
        <h2>Patient Information</h2>
        <div class="info-row"><span>Name</span><span>${escapeHtml(patient.name || input.patient_name || 'not available')}</span></div>
        <div class="info-row"><span>Age/Gender</span><span>${escapeHtml(patient.age || 'not available')} / ${escapeHtml(patient.sex || 'not available')}</span></div>
        <div class="info-row"><span>Language</span><span>${escapeHtml(language.name)}</span></div>
      </div>
      <div class="info-card">
        <h2>Report Details</h2>
        <div class="info-row"><span>Report Date</span><span>${escapeHtml(patient.report_date || 'not available')}</span></div>
        <div class="info-row"><span>Doctor</span><span>${escapeHtml(patient.doctor_name || 'not available')}</span></div>
        <div class="info-row"><span>Report Type</span><span>${escapeHtml(input.report_type)}</span></div>
      </div>
    </div>
    ${pageKind === 'first' ? `
      <div class="test-scope">
        <h2>Tests Included</h2>
        <div class="test-list">${testChips || '<span class="test-chip">Extracted report values</span>'}</div>
      </div>
    ` : closing}
    <div class="disclaimer">This AI-enhanced report provides a patient-friendly summary. Please consult your physician for medical interpretation.</div>
  </div>
</body>
</html>`;
}

async function convertHtmlToPdfCo(html: string, name: string) {
  const apiKey = Deno.env.get('PDFCO_API_KEY');
  if (!apiKey) {
    throw new Error('PDFCO_API_KEY is required for branded first/last pages');
  }

  const response = await runtimeFetch('https://api.pdf.co/v1/pdf/convert/from/html', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      html,
      name,
      paperSize: 'A4',
      margins: '0px 0px 0px 0px',
      async: false,
      printBackground: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF.co branded page error ${response.status}: ${text}`);
  }

  const result = await response.json();
  if (result.error || !result.url) {
    throw new Error(result.message || 'PDF.co did not return branded page URL');
  }

  return result.url as string;
}

async function mergePdfUrlsWithPdfCo(urls: string[], name: string) {
  const apiKey = Deno.env.get('PDFCO_API_KEY');
  if (!apiKey) {
    throw new Error('PDFCO_API_KEY is required to merge branded pages');
  }

  const response = await runtimeFetch('https://api.pdf.co/v1/pdf/merge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      url: urls.join(','),
      name,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF.co merge error ${response.status}: ${text}`);
  }

  const result = await response.json();
  if (result.error || !result.url) {
    throw new Error(result.message || 'PDF.co did not return merged PDF URL');
  }

  return result.url as string;
}

async function addFirstAndLastBrandedPages(generatedReportUrl: string, data: ExtractedReport, input: GenerateRequest) {
  if (!input.letterhead_url) return generatedReportUrl;

  if (!isImageUrl(input.letterhead_url)) {
    console.warn('[generate-pathology-infographic] Letterhead URL is not an image. Branded page content will render without a CSS background. Use PNG/JPG A4 letterhead for full-page background branding.');
  }

  logStage('branded_pages_start', {
    request_id: input.request_id,
    letterhead_url: input.letterhead_url,
    image_background: isImageUrl(input.letterhead_url),
    content_top_padding_px: 250,
    content_bottom_padding_px: 140,
  });

  const firstPageUrl = await convertHtmlToPdfCo(
    buildBrandedPageHtml(data, input, 'first'),
    `smart-report-first-page-${input.request_id}.pdf`
  );
  const lastPageUrl = await convertHtmlToPdfCo(
    buildBrandedPageHtml(data, input, 'last'),
    `smart-report-last-page-${input.request_id}.pdf`
  );

  const mergedUrl = await mergePdfUrlsWithPdfCo(
    [firstPageUrl, generatedReportUrl, lastPageUrl],
    `smart-report-branded-${input.request_id}.pdf`
  );

  logStage('branded_pages_done', { merged_url: mergedUrl });
  return mergedUrl;
}

/**
 * Panel diagrams and the rows each one's artwork lays out, in order.
 *
 * Every template has a fixed number of rows - the artwork cannot grow - so a
 * panel is drawn only when all of its rows are present in the report. The
 * `style` says which token set the template exposes:
 *   'table' -> R<n>_NAME / _VALUE / _UNIT / _RANGE / _STATUS (one cell each)
 *   'list'  -> R<n>_NAME plus R<n>_DETAIL ("11.5 g/dL; status low")
 */
const PANEL_DIAGRAMS: Array<{
  template: DiagramTemplate;
  title: string;
  style: 'table' | 'list' | 'map' | 'matrix3' | 'qual' | 'screen';
  /**
   * When set, a row may only be filled from sections whose name matches -
   * "Sugar" must come from the urine section, never the glucose panel.
   */
  sectionFilter?: RegExp;
  /**
   * `nameLines` > 1 when the artwork wraps that row's label across two text
   * slots (R<n>_NAME_L1 / _L2) instead of a single R<n>_NAME.
   */
  rows: Array<{
    /** Canonical analyte key, for rows the extractor can identify. */
    key?: string;
    /**
     * Slot id for rows with no canonical key (urine descriptors, serology).
     * Filled by the AI slot mapper, with `match` as the deterministic
     * fallback against the lab's own test names.
     */
    slot?: string;
    match?: RegExp;
    label: string;
    nameLines?: number;
    /**
     * Name of a calculated index to use when no extracted test carries this
     * key. Non-HDL cholesterol, for instance, is computed rather than
     * measured, so without this the row claimed "not done" for a figure the
     * indices table printed on the next page.
     */
    fromIndex?: string;
  }>;
}> = [
  {
    template: LIPID_PANEL, title: 'Lipid Profile Results', style: 'table',
    rows: [
      { key: 'total_cholesterol', label: 'Total Cholesterol' },
      { key: 'hdl', label: 'HDL Cholesterol' },
      { key: 'ldl', label: 'LDL Cholesterol' },
      { key: 'triglycerides', label: 'Triglycerides' },
      { key: 'non_hdl', label: 'Non-HDL Cholesterol', fromIndex: 'Non-HDL Cholesterol' },
    ],
  },
  {
    template: BIOCHEM_PANEL, title: 'Kidney & Liver Biochemistry', style: 'table',
    rows: [
      { key: 'creatinine', label: 'Creatinine' },
      { key: 'bun', label: 'BUN' },
      { key: 'urea', label: 'Urea' },
      { key: 'uric_acid', label: 'Uric Acid' },
      { key: 'calcium', label: 'Calcium' },
      { key: 'bilirubin_total', label: 'Total Bilirubin' },
      { key: 'ast', label: 'SGOT (AST)' },
      { key: 'alt', label: 'SGPT (ALT)' },
      { key: 'alp', label: 'Alkaline Phosphatase', nameLines: 2 },
      { key: 'albumin', label: 'Albumin' },
    ],
  },
  {
    // The radial mindmap: a different visual language from the two column
    // panels and the fishbone. The artwork's chips hold value+unit in one
    // slot, hence style 'map'.
    template: VITAMINS_PANEL, title: 'Vitamins & Anaemia', style: 'map',
    rows: [
      { key: 'iron', label: 'Iron' },
      { key: 'ferritin', label: 'Ferritin' },
      { key: 'vitamin_b12', label: 'Vitamin B12' },
      { key: 'vitamin_d', label: 'Vitamin D' },
      { key: 'hemoglobin', label: 'Haemoglobin' },
    ],
  },
  {
    // Attribute matrix: three hormones across, name/status/range/value down.
    template: THYROID_PANEL, title: 'Thyroid Profile', style: 'matrix3',
    rows: [
      { key: 'tsh', label: 'TSH' },
      { key: 'free_t3', label: 'Free T3' },
      { key: 'free_t4', label: 'Free T4' },
    ],
  },
  {
    // Result/Status checklist for the urinalysis descriptors, none of which
    // have canonical keys - slots are AI-mapped with regex fallback.
    template: URINE_PANEL, title: 'Urine Analysis', style: 'qual',
    sectionFilter: /urin/i,
    rows: [
      { slot: 'colour', match: /colou?r/i, label: 'Colour' },
      { slot: 'appearance', match: /appearance|aspect|turbid/i, label: 'Appearance' },
      { slot: 'ph', match: /\bph\b|reaction/i, label: 'pH' },
      { slot: 'gravity', match: /specific gravity|sp\.?\s*gr/i, label: 'Specific Gravity' },
      { slot: 'protein', match: /protein|albumin/i, label: 'Protein (Albumin)' },
      { slot: 'sugar', match: /sugar|glucose/i, label: 'Sugar' },
      { slot: 'ketone', match: /ketone/i, label: 'Ketone' },
      { slot: 'pus_cells', match: /pus/i, label: 'Pus Cells' },
      { slot: 'rbc', match: /red blood|\brbc\b/i, label: 'Red Blood Cells' },
      { slot: 'epithelial', match: /epithelial/i, label: 'Epithelial Cells' },
    ],
  },
  {
    // Badge rows for the screening serology; the word the lab printed
    // (NEGATIVE, Non-Reactive) is shown verbatim.
    template: SEROLOGY_PANEL, title: 'Infection Screening', style: 'screen',
    rows: [
      { slot: 'hiv', match: /\bhiv\b/i, label: 'HIV I and II' },
      { slot: 'hbsag', match: /hbs\s*ag|hepatitis b|australia antigen/i, label: 'HBsAg (Hepatitis B)', nameLines: 2 },
      { slot: 'hcv', match: /\bhcv\b|hepatitis c/i, label: 'HCV (Hepatitis C)', nameLines: 2 },
      { slot: 'vdrl', match: /vdrl|syphilis|\brpr\b/i, label: 'VDRL (Syphilis)' },
    ],
  },
];

/**
 * Slot ids and their meanings, for the AI slot mapper's prompt. Built from
 * the panel table so the two can never drift apart.
 */
function diagramSlotCatalog(): Array<{ id: string; description: string }> {
  const out: Array<{ id: string; description: string }> = [];
  for (const panel of PANEL_DIAGRAMS) {
    for (const row of panel.rows) {
      if (!row.slot) continue;
      out.push({
        id: `${panel.template.id}.${row.slot}`,
        description: `${row.label} (${panel.title}${panel.sectionFilter ? ', from a urine section only' : ''})`,
      });
    }
  }
  return out;
}

/**
 * Asks Claude to assign extracted rows to diagram slots, returning row
 * INDEXES only. The values themselves are copied out of the chosen rows by
 * code, so this call can route data but cannot alter it. Test and parameter
 * names differ across labs, which is exactly what a language model handles
 * better than an alias table.
 *
 * Returns null on any failure; every slot then falls back to its regex.
 */
/** What the routing call returns: slot assignments plus the calc-card ranking. */
interface DiagramRouting {
  slots: Record<string, number>;
  calcTop: number[];
}

async function buildDiagramSlotMapWithAI(
  data: ExtractedReport,
  calculations?: CalculationsResult,
): Promise<DiagramRouting | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const slots = diagramSlotCatalog();
  if (!slots.length) return null;

  // Flattened in the same section-then-test order buildReportViewModel uses
  // for `classified`, so the indexes line up between the two.
  const rows: string[] = [];
  (data.test_sections || []).forEach((section) => {
    for (const test of section.tests || []) {
      rows.push(`${rows.length}: ${section.section_name || '?'} | ${test.test_name} | ${test.value}`);
    }
  });
  if (!rows.length) return null;

  // Calculated indices, for the "which deserve a logic card" ranking.
  const calcRows = (calculations?.individual_indices || [])
    .map((idx, i) => `${i}: ${idx.name} | ${idx.value}${idx.unit ? ` ${idx.unit}` : ''} | ${idx.status}`);

  const prompt = [
    'Assign lab report rows to diagram slots.',
    '',
    'ROWS (index: section | test name | value):',
    ...rows,
    '',
    'SLOTS (id: what belongs there):',
    ...slots.map((slot) => `${slot.id}: ${slot.description}`),
    '',
    ...(calcRows.length
      ? ['', 'CALCULATED INDICES (index: name | value | status):', ...calcRows]
      : []),
    '',
    'Answer with ONLY a JSON object mapping every slot id to a row index or null.',
    'Use null unless a listed row clearly is that slot. Never assign a blood test',
    'to a urine slot. Use each row index at most once.',
    ...(calcRows.length
      ? ['Also include "calc_top": an array of up to 4 CALCULATED INDICES indexes,',
        'the most clinically important for this patient first (abnormal and',
        'consequential results first; skip restatements such as a stage that',
        'repeats another index).']
      : []),
  ].join('\n');

  const response = await runtimeFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`slot mapper: Anthropic ${response.status}`);
  const result = await response.json();
  const text: string = result.content?.find((part: { type: string }) => part.type === 'text')?.text || '';
  const body = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));

  const map: Record<string, number> = {};
  const used = new Set<number>();
  for (const slot of slots) {
    const idx = (parsed as Record<string, unknown>)[slot.id];
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= rows.length) continue;
    if (used.has(idx)) continue;
    used.add(idx);
    map[slot.id] = idx;
  }

  const calcTop: number[] = [];
  const rawTop = (parsed as Record<string, unknown>)['calc_top'];
  if (Array.isArray(rawTop)) {
    for (const v of rawTop) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= calcRows.length) continue;
      if (calcTop.includes(v)) continue;
      calcTop.push(v);
      if (calcTop.length >= 4) break;
    }
  }
  return { slots: map, calcTop };
}

/**
 * The CBC is drawn as a fishbone grouped by cell family rather than as
 * another row-of-bars table - the panel's own structure is the story, and
 * repeating the bar motif a third time is what made earlier drafts read as
 * one component over and over.
 *
 * Its captions are free text rather than table cells, so it is built
 * separately from the PANEL_DIAGRAMS table above.
 */
const CBC_FISHBONE_GROUPS: Array<{ nameTokens: string[]; label: string; rows: Array<{ key: string; label: string; tokens: string[] }> }> = [
  {
    nameTokens: ['G1_NAME'], label: 'Red blood cells',
    rows: [
      { key: 'hemoglobin', label: 'Haemoglobin', tokens: ['G1_R1_L1', 'G1_R1_L2'] },
      // PCV and haematocrit are the same measurement; the extractor emits it
      // as 'hematocrit', so keying on 'pcv' reported "not done" for a value
      // the report listed two pages later.
      { key: 'hematocrit', label: 'PCV', tokens: ['G1_R2'] },
      { key: 'mch', label: 'MCH', tokens: ['G1_R3'] },
    ],
  },
  {
    nameTokens: ['G2_NAME_L1', 'G2_NAME_L2'], label: 'White blood cells',
    rows: [
      { key: 'wbc', label: 'WBC Count', tokens: ['G2_R1_L1', 'G2_R1_L2'] },
      { key: 'lymphocytes', label: 'Lymphocytes', tokens: ['G2_R2_L1', 'G2_R2_L2'] },
      { key: 'neutrophils', label: 'Neutrophils', tokens: ['G2_R3'] },
    ],
  },
  {
    nameTokens: ['G3_NAME'], label: 'Platelets',
    rows: [{ key: 'platelets', label: 'Platelets Count', tokens: ['G3_R1_L1', 'G3_R1_L2', 'G3_R1_L3'] }],
  },
  {
    nameTokens: ['G4_NAME'], label: 'Inflammation',
    rows: [{ key: 'esr', label: 'ESR', tokens: ['G4_R1'] }],
  },
];

/**
 * Placeholders for a test the lab did not report. Kept short because each
 * token's length budget is measured from the text the artwork was authored
 * with, and a long phrase would be truncated mid-word.
 */
const DASH = '—';
const NOT_REPORTED = 'not done';
const NOT_REPORTED_DETAIL = 'not reported';
/** Shown in the range column for a value we computed rather than measured. */
const CALCULATED = 'calculated';

/**
 * Splits one caption across the fixed number of text lines the artwork has
 * for it, breaking on spaces so a line never ends mid-word.
 */
function splitAcrossLines(text: string, lines: number): string[] {
  if (lines <= 1) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const perLine = Math.ceil(words.length / lines);
  const out: string[] = [];
  for (let i = 0; i < lines; i++) out.push(words.slice(i * perLine, (i + 1) * perLine).join(' '));
  return out;
}

/**
 * Fills the frozen diagram templates with this patient's values.
 *
 * Each diagram is all-or-nothing: a partially filled one would leave a raw
 * {{TOKEN}} in a patient's PDF, so renderDiagram returns null instead and we
 * simply omit it - the same values still appear in the tables below.
 */
function buildDiagrams(
  classified: Array<{ section: string; test: ExtractedTest; cls: TestClassification }>,
  patientSex: string | undefined,
  calculations?: CalculationsResult,
  /** AI slot assignments (slot id -> index into `classified`), or null. */
  slotMap?: Record<string, number> | null,
): { diagrams: ReportViewModel['diagrams']; used: Set<ExtractedTest> } {
  const byKey = new Map<string, { test: ExtractedTest; cls: TestClassification }>();
  for (const row of classified) {
    // The extractor's canonical_key first, the deterministic name resolver
    // second. The extractor sometimes keys only one of two rows that share
    // an analyte (ESR at one hour and at two), and if the unkeyed one is
    // the flagged one, the flagged-outranks-normal rule below never sees it
    // - the fishbone then shows a normal ESR beside findings that flag it.
    const key = row.test.canonical_key
      ? String(row.test.canonical_key)
      : (resolveLabValueKey(row.test.test_name) ?? '');
    if (!key) continue;
    const existing = byKey.get(key);
    // Several printed rows can share one key - a report lists ESR at one hour
    // and at two hours, both keyed 'esr'. Keep the first, except that a
    // flagged result outranks a normal one: showing the normal 1-hour ESR
    // while the rest of the report flags the 2-hour value as high made the
    // diagram contradict the findings beside it.
    const isFlagged = row.cls === 'high' || row.cls === 'low' || row.cls === 'critical';
    const existingFlagged = existing
      && (existing.cls === 'high' || existing.cls === 'low' || existing.cls === 'critical');
    if (!existing || (isFlagged && !existingFlagged)) {
      byKey.set(key, { test: row.test, cls: row.cls });
    }
  }

  /** Calculated indices by name, for rows that are computed rather than measured. */
  const byIndexName = new Map<string, { value: string; status: string }>();
  for (const idx of calculations?.individual_indices || []) {
    byIndexName.set(idx.name.trim().toLowerCase(), {
      value: `${idx.value}${idx.unit ? ` ${idx.unit}` : ''}`,
      status: idx.status || 'normal',
    });
  }

  const diagrams: NonNullable<ReportViewModel['diagrams']> = [];
  // Rows a RENDERED panel displays, by object identity. The tables at the
  // end of the report drop these so they only carry what no panel shows.
  const used = new Set<ExtractedTest>();

  for (const panel of PANEL_DIAGRAMS) {
    const hits = panel.rows.map((row) => {
      let hit = row.key ? byKey.get(row.key) : undefined;
      if (!hit && row.slot) {
        // AI assignment first; it is only trusted within the panel's
        // section filter, so a mapper mistake cannot put a blood value in a
        // urine slot. The values always come from the row itself.
        const idx = slotMap?.[`${panel.template.id}.${row.slot}`];
        const candidate = idx !== undefined ? classified[idx] : undefined;
        if (candidate && (!panel.sectionFilter || panel.sectionFilter.test(candidate.section))) {
          hit = { test: candidate.test, cls: candidate.cls };
        }
        if (!hit && row.match) {
          const found = classified.find((r) =>
            (!panel.sectionFilter || panel.sectionFilter.test(r.section)) && row.match!.test(r.test.test_name));
          if (found) hit = { test: found.test, cls: found.cls };
        }
      }
      return {
        ...row,
        hit,
        calc: row.fromIndex ? byIndexName.get(row.fromIndex.trim().toLowerCase()) : undefined,
      };
    });
    const missing = hits.filter((row) => !row.hit && !row.calc).map((row) => row.key ?? row.slot ?? row.label);

    // A panel still draws when a test is absent: that row shows the test
    // name with dashes, which tells the reader it was not reported rather
    // than hiding the whole panel. Only bail when so little is present that
    // the artwork would be mostly placeholder.
    const present = hits.length - missing.length;
    if (present < Math.max(2, Math.ceil(hits.length / 2))) {
      logStage('diagram_skipped', {
        diagram: panel.template.id,
        reason: 'too_few_values',
        present,
        of: hits.length,
        missing,
      });
      continue;
    }
    if (missing.length) {
      logStage('diagram_partial', { diagram: panel.template.id, missing });
    }

    const values: Record<string, string> = { TITLE: panel.title };
    hits.forEach((row, index) => {
      const n = index + 1;
      if (row.nameLines && row.nameLines > 1) {
        splitAcrossLines(row.label, row.nameLines)
          .forEach((line, i) => { values[`R${n}_NAME_L${i + 1}`] = line; });
      } else {
        values[`R${n}_NAME`] = row.label;
      }

      if (!row.hit) {
        if (row.calc) {
          // computed index: it has a value and a status but no lab range
          const [calcValue, ...calcUnit] = row.calc.value.split(' ');
          if (panel.style === 'list') {
            values[`R${n}_DETAIL`] = `${row.calc.value}; status ${row.calc.status}`;
          } else if (panel.style === 'map') {
            values[`R${n}_VALUE`] = row.calc.value;
            values[`R${n}_RANGE`] = CALCULATED;
            values[`R${n}_STATUS`] = row.calc.status;
          } else {
            values[`R${n}_VALUE`] = calcValue;
            values[`R${n}_UNIT`] = calcUnit.join(' ');
            values[`R${n}_RANGE`] = CALCULATED;
            values[`R${n}_STATUS`] = row.calc.status;
          }
          return;
        }
        if (panel.style === 'list') {
          values[`R${n}_DETAIL`] = NOT_REPORTED_DETAIL;
        } else if (panel.style === 'matrix3') {
          values[`R${n}_VALUE`] = DASH;
          values[`R${n}_RANGE`] = DASH;
          values[`R${n}_STATUS`] = NOT_REPORTED;
        } else if (panel.style === 'qual') {
          values[`R${n}_RESULT`] = DASH;
          values[`R${n}_STATUS`] = NOT_REPORTED;
        } else if (panel.style === 'screen') {
          values[`R${n}_RESULT`] = DASH;
        } else if (panel.style === 'map') {
          values[`R${n}_VALUE`] = DASH;
          values[`R${n}_RANGE`] = DASH;
          values[`R${n}_STATUS`] = NOT_REPORTED;
        } else {
          values[`R${n}_VALUE`] = DASH;
          values[`R${n}_UNIT`] = DASH;
          values[`R${n}_RANGE`] = DASH;
          values[`R${n}_STATUS`] = NOT_REPORTED;
        }
        return;
      }

      const { test, cls } = row.hit;
      const unit = test.unit && test.unit !== 'not available' ? test.unit : '';
      const status = cls === 'unclassified' ? 'not graded' : cls;
      if (panel.style === 'qual') {
        // The lab's own words, both the name and the finding. For a
        // descriptor with no printed range the status column stays quiet
        // rather than claiming "normal" for a value nobody graded.
        values[`R${n}_NAME`] = test.test_name;
        values[`R${n}_RESULT`] = test.value;
        values[`R${n}_STATUS`] = cls === 'unclassified' ? DASH : status;
        return;
      }
      if (panel.style === 'screen') {
        if (row.nameLines && row.nameLines > 1) {
          splitAcrossLines(test.test_name, row.nameLines)
            .forEach((line, i) => { values[`R${n}_NAME_L${i + 1}`] = line; });
        } else {
          values[`R${n}_NAME`] = test.test_name;
        }
        values[`R${n}_RESULT`] = test.value;
        return;
      }
      if (panel.style === 'list') {
        values[`R${n}_DETAIL`] = `${test.value}${unit ? ` ${unit}` : ''}; status ${status}`;
      } else {
        // Use the parsed numeric bounds, not the lab's printed prose. A
        // string like "< 100 : Optimal / 100 - 129 : Near Optimal / ..." does
        // not fit a table cell and was rendering as "< 100 :...".
        const bounds = parseReferenceBounds(test.reference_range, patientSex);
        let rangeText = DASH;
        if (bounds?.low !== undefined && bounds?.high !== undefined) {
          rangeText = `${bounds.low} - ${bounds.high}`;
        } else if (bounds?.high !== undefined) {
          rangeText = `≤ ${bounds.high}`;
        } else if (bounds?.low !== undefined) {
          rangeText = `≥ ${bounds.low}`;
        } else if (hasUsableRange(test.reference_range)) {
          rangeText = String(test.reference_range);
        }
        if (panel.style === 'map') {
          values[`R${n}_VALUE`] = `${test.value}${unit ? ` ${unit}` : ''}`;
        } else if (panel.style === 'matrix3') {
          // The artwork's range slot carries the unit too ("0.31 - 4.53 uIU/mL").
          values[`R${n}_VALUE`] = `${test.value}${unit ? ` ${unit}` : ''}`;
          values[`R${n}_RANGE`] = rangeText === DASH ? DASH : `${rangeText}${unit ? ` ${unit}` : ''}`;
          values[`R${n}_STATUS`] = status;
          return;
        } else {
          values[`R${n}_VALUE`] = test.value;
          values[`R${n}_UNIT`] = unit;
        }
        values[`R${n}_RANGE`] = rangeText;
        values[`R${n}_STATUS`] = status;
      }
    });

    // A flagged row's value carries the same emphasis as its status word.
    const emphasize = new Set<string>();
    hits.forEach((row, i) => {
      const cls = row.hit?.cls;
      if (cls !== 'high' && cls !== 'low' && cls !== 'critical') return;
      const n = i + 1;
      if (panel.style === 'qual' || panel.style === 'screen') emphasize.add(`R${n}_RESULT`);
      else if (panel.style === 'list') emphasize.add(`R${n}_DETAIL`);
      else emphasize.add(`R${n}_VALUE`);
    });

    const svg = renderDiagram(panel.template, values, (message) => logStage('diagram_warning', { message }), emphasize);
    if (svg) {
      diagrams.push({ title: panel.template.title, svg });
      for (const row of hits) if (row.hit) used.add(row.hit.test);
    }
  }

  // CBC fishbone - same degrade-don't-skip rule: an absent test shows as
  // "<name> not reported" on its bone.
  const cbcRows = CBC_FISHBONE_GROUPS.flatMap((g) => g.rows);
  const cbcMissing = cbcRows.filter((r) => !byKey.has(r.key)).map((r) => r.key);
  const cbcPresent = cbcRows.length - cbcMissing.length;
  if (cbcPresent < Math.max(2, Math.ceil(cbcRows.length / 2))) {
    logStage('diagram_skipped', {
      diagram: CBC_FISHBONE.id,
      reason: 'too_few_values',
      present: cbcPresent,
      of: cbcRows.length,
      missing: cbcMissing,
    });
  } else {
    if (cbcMissing.length) logStage('diagram_partial', { diagram: CBC_FISHBONE.id, missing: cbcMissing });
    const values: Record<string, string> = { TITLE: 'Complete Blood Count Results' };
    const emphasize = new Set<string>();
    for (const group of CBC_FISHBONE_GROUPS) {
      splitAcrossLines(group.label, group.nameTokens.length)
        .forEach((line, i) => { values[group.nameTokens[i]] = line; });
      for (const row of group.rows) {
        const hit = byKey.get(row.key);
        let caption: string;
        if (hit) {
          const unit = hit.test.unit && hit.test.unit !== 'not available' ? hit.test.unit : '';
          const status = hit.cls === 'unclassified' ? '' : hit.cls;
          caption = `${row.label} ${hit.test.value}${unit ? ` ${unit}` : ''}${status ? ` ${status}` : ''}`;
          if (hit.cls === 'high' || hit.cls === 'low' || hit.cls === 'critical') {
            for (const token of row.tokens) emphasize.add(token);
          }
        } else {
          caption = `${row.label} ${NOT_REPORTED}`;
        }
        splitAcrossLines(caption, row.tokens.length)
          .forEach((line, i) => { values[row.tokens[i]] = line; });
      }
    }
    const svg = renderDiagram(CBC_FISHBONE, values, (message) => logStage('diagram_warning', { message }), emphasize);
    if (svg) {
      diagrams.push({ title: CBC_FISHBONE.title, svg });
      for (const row of cbcRows) {
        const hit = byKey.get(row.key);
        if (hit) used.add(hit.test);
      }
    }
  }

  return { diagrams: diagrams.length ? diagrams : undefined, used };
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  smart_report: 'Smart Report',
  trend_analysis: 'Trend Analysis',
  longitivity_report: 'Longevity Report',
};

/**
 * Builds the fully computed view model for the in-house HTML template.
 * Reuses the same classification helpers as the Gamma layout prompt, so the
 * two renderers can never disagree about counts, flags, or the no-range rule.
 */

// ---------------------------------------------------------------------------
// Calculation logic cards
// ---------------------------------------------------------------------------

/**
 * Which lab rows feed each calculated index, for the "Patient Data" band of
 * its logic card. Values are taken verbatim from the lab's own printed rows
 * (found by canonical key), so a card can never show an input the report
 * does not contain.
 */
const CALC_CARD_INPUTS: Array<{ match: RegExp; keys: string[]; withAge?: boolean; withSex?: boolean }> = [
  { match: /^egfr$/i, keys: ['creatinine'], withAge: true, withSex: true },
  { match: /creatinine clearance/i, keys: ['creatinine'], withAge: true, withSex: true },
  { match: /bun.creatinine/i, keys: ['bun', 'urea', 'creatinine'] },
  { match: /ast.alt|de ritis/i, keys: ['ast', 'alt'] },
  { match: /fib-?4/i, keys: ['ast', 'alt', 'platelets'], withAge: true },
  { match: /non-hdl/i, keys: ['total_cholesterol', 'hdl'] },
  { match: /remnant/i, keys: ['total_cholesterol', 'hdl', 'ldl'] },
  { match: /atherogenic|aip/i, keys: ['triglycerides', 'hdl'] },
  { match: /triglyceride.hdl/i, keys: ['triglycerides', 'hdl'] },
  { match: /tyg/i, keys: ['triglycerides', 'fasting_glucose'] },
  { match: /average glucose|eag/i, keys: ['hba1c'] },
  { match: /mentzer/i, keys: ['mcv', 'rbc'] },
  { match: /nlr|neutrophil.lymphocyte/i, keys: ['neutrophils', 'lymphocytes'] },
  { match: /plr|platelet.lymphocyte/i, keys: ['platelets', 'lymphocytes'] },
  { match: /sii|immune.inflammation/i, keys: ['platelets', 'neutrophils', 'lymphocytes'] },
];

/** Indices that never get a card: restatements and biometric-only values. */
const CALC_CARD_EXCLUDE = /ckd stage|egfr category|bsa|biological age|longevity/i;

/** Greedy word wrap into exactly `lineCount` lines; overflow joins the last line. */
function wrapLines(text: string, width: number, lineCount: number): string[] {
  const words = String(text).split(/ +/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > lineCount) {
    // Clamp at a word boundary; a mid-word cut from the renderer's own
    // budget check reads worse than losing the final clause.
    let tail = lines.splice(lineCount - 1).join(' ');
    if (tail.length > width) {
      const cut = tail.lastIndexOf(' ', width - 1);
      tail = `${tail.slice(0, cut > 0 ? cut : width - 1)}…`;
    }
    lines.push(tail);
  }
  while (lines.length < lineCount) lines.push('');
  return lines;
}

/** A title that fits the card's centre slot; prefers the parenthetical expansion. */
function calcCardTitle(name: string): string {
  if (name.length <= 32) return name;
  const paren = /[(]([^)]+)[)]/.exec(name)?.[1];
  if (paren && paren.length <= 32) return paren;
  return name.replace(/ *[(][^)]*[)] */g, ' ').trim();
}

/**
 * The staged CKD-EPI walkthrough. Only true for creatinine in mg/dL with a
 * known age; anything else falls back to the generic five-band card rather
 * than showing a wrong derivation.
 */
function renderEgfrStepsCard(
  idx: CalculatedIndex,
  byKey: Map<string, ExtractedTest>,
  patient: { age?: string; sex?: string },
  warn: (message: string) => void,
): string | null {
  const creatRow = byKey.get('creatinine');
  const creat = creatRow ? parseNumericValue(creatRow.value) : null;
  const age = Number(/[0-9]+/.exec(String(patient.age ?? ''))?.[0]);
  const unit = (creatRow?.unit || '').toLowerCase();
  if (!creatRow || creat === null || !Number.isFinite(age) || age <= 0) return null;
  if (unit && unit !== 'not available' && !unit.includes('mg')) return null;

  const sex = patient.sex === 'Female' ? 'Female' : patient.sex === 'Male' ? 'Male' : null;
  const k = sex === 'Female' ? 0.7 : 0.9;
  const alpha = sex === 'Female' ? -0.241 : -0.302;
  const mult = sex === 'Female' ? 1.012 : 1;
  const scrK = Math.round((creat / k) * 10000) / 10000;
  const sexNote = sex ? `(${sex})` : '(default)';

  // "Mildly decreased (G2 range)" carries both the category and the words.
  const stageNum = /[(]G([0-9]+[ab]?) range[)]/i.exec(idx.interpretation)?.[1];
  const desc = wrapLines(idx.interpretation.replace(/ *[(]G[0-9]+[ab]? range[)]/i, '').trim(), 16, 2);

  return renderDiagram(CALC_STEPS, {
    IN_AGE: `Age: ${age} years`,
    IN_SEX: `Sex: ${sex ?? 'not stated'}`,
    IN_CR: `Creatinine: ${creatRow.value}`,
    IN_CR_UNIT: creatRow.unit && creatRow.unit !== 'not available' ? creatRow.unit : 'mg/dL',
    K_LINE: `k = ${k} ${sexNote}`,
    A_L1: `α = ${alpha}`,
    A_L2: sexNote,
    M_L1: `sexMult = ${mult}`,
    M_L2: sexNote,
    SCRK_L1: `scrK = ${creat} / ${k}`,
    SCRK_L2: `= ${scrK}`,
    F_L1: 'eGFR = 142 ×',
    F_L2: `min(${scrK},1)^${alpha}`,
    F_L4: `max(${scrK},1)^-1.200`,
    F_L5: `× 0.9938^${age} × ${mult}`,
    RES_VALUE: `eGFR: ${idx.value}`,
    ST_L1: stageNum ? `Status: G${stageNum} —` : 'Status —',
    ST_L2: desc[0],
    ST_L3: desc[1],
  }, warn);
}

/** The two-branch Mentzer screening flowchart, with the patient's own numbers. */
function renderMentzerFlowCard(
  idx: CalculatedIndex,
  byKey: Map<string, ExtractedTest>,
  warn: (message: string) => void,
): string | null {
  const mcv = byKey.get('mcv');
  const rbc = byKey.get('rbc');
  const value = typeof idx.value === 'number' ? idx.value : Number(idx.value);
  if (!mcv || !rbc || !Number.isFinite(value)) return null;
  return renderDiagram(CALC_FLOW, {
    CALC_VALUES: `(${mcv.value} / ${rbc.value})`,
    NOTE_L1: `Your index: ${idx.value} —`,
    NOTE_L2: value < 13 ? 'thalassemia trait pattern;' : 'iron deficiency pattern;',
    NOTE_L3: 'not a definitive diagnosis',
  }, warn);
}

/** The generic five-band card: inputs, formula, score, status, reference. */
function renderCalcBandsCard(
  idx: CalculatedIndex,
  byKey: Map<string, ExtractedTest>,
  patient: { age?: string; sex?: string },
  warn: (message: string) => void,
): string | null {
  const meta = CALC_CARD_INPUTS.find((m) => m.match.test(idx.name));
  const inputs: string[] = [];
  if (meta?.withAge && patient.age) inputs.push(`Age: ${String(patient.age).trim()}`);
  if (meta?.withSex && patient.sex) inputs.push(`Sex: ${patient.sex}`);
  for (const key of meta?.keys || []) {
    const row = byKey.get(key);
    if (!row) continue;
    const unit = row.unit && row.unit !== 'not available' ? ` ${row.unit}` : '';
    inputs.push(`${row.test_name}: ${row.value}${unit}`);
  }
  const data = inputs.length
    ? wrapLines(inputs.join(', '), 42, 2)
    : [`From your ${idx.category.toLowerCase()} results`, ''];
  const formula = wrapLines(idx.formula || '', 42, 2);
  const status = wrapLines(`${idx.status.toUpperCase()} — ${idx.interpretation}`, 42, 2);
  const ref = wrapLines(idx.reference_range ? `Reference: ${idx.reference_range}` : 'See the indices table', 42, 2);
  const shortName = idx.name.replace(/ *[(][^)]*[)] */g, ' ').trim();
  const flagged = idx.status === 'high' || idx.status === 'low' || idx.status === 'elevated';
  return renderDiagram(CALC_BANDS, {
    TITLE: calcCardTitle(idx.name),
    DATA_L1: data[0], DATA_L2: data[1],
    FORMULA_L1: formula[0], FORMULA_L2: formula[1],
    SCORE: `${shortName}: ${idx.value}${idx.unit ? ` ${idx.unit}` : ''}`,
    STATUS_L1: status[0], STATUS_L2: status[1],
    REF_L1: ref[0], REF_L2: ref[1],
  }, warn, flagged ? new Set(['SCORE']) : undefined);
}

/**
 * Picks the 3-4 most important calculated indices and renders their logic
 * cards. The AI ranking (indexes into individual_indices) leads; a
 * deterministic abnormal-first order stands in when the call failed. Every
 * character on a card is composed here from the computed index and the
 * lab's own rows - the AI routes, it cannot write.
 */
function buildCalcCards(
  calculations: CalculationsResult | undefined,
  classified: Array<{ section: string; test: ExtractedTest; cls: TestClassification }>,
  patient: { age?: string; sex?: string },
  calcTop?: number[] | null,
): { cards: NonNullable<ReportViewModel['calcCards']>; used: Set<CalculatedIndex> } {
  const cards: NonNullable<ReportViewModel['calcCards']> = [];
  const used = new Set<CalculatedIndex>();
  const all = calculations?.individual_indices || [];
  if (!all.length) return { cards, used };

  const warn = (message: string) => logStage('diagram_warning', { message });

  const byKey = new Map<string, ExtractedTest>();
  for (const row of classified) {
    const key = row.test.canonical_key
      ? String(row.test.canonical_key)
      : (resolveLabValueKey(row.test.test_name) ?? '');
    if (key && !byKey.has(key)) byKey.set(key, row.test);
  }

  // An index the lab printed itself never gets a card: the lab's row wins
  // (it sits beside the lab's own reference), and a card computed against
  // our standard range could carry a conflicting verdict - the same rule
  // the indices table applies.
  const printedNames = new Set(
    classified.map((row) => row.test.test_name.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );
  const eligible = (idx: CalculatedIndex) =>
    idx.status !== 'not_calculated' && !CALC_CARD_EXCLUDE.test(idx.name) &&
    idx.unit !== '/100' && Boolean(idx.formula) &&
    !printedNames.has(idx.name.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const ranked: CalculatedIndex[] = [];
  for (const i of calcTop || []) {
    const idx = all[i];
    if (idx && eligible(idx) && !ranked.includes(idx)) ranked.push(idx);
  }
  if (!ranked.length) {
    const weight = (status: CalculatedIndex['status']) =>
      status === 'high' || status === 'low' || status === 'elevated' ? 2 : status === 'borderline' ? 1 : 0;
    const PRIORITY = [/^egfr$/i, /fib-?4/i, /tyg/i, /mentzer/i, /non-hdl/i, /nlr/i, /remnant/i, /bun.creatinine/i];
    const pri = (name: string) => {
      const i = PRIORITY.findIndex((re) => re.test(name));
      return i === -1 ? PRIORITY.length : i;
    };
    ranked.push(...all.filter(eligible).sort((a, b) =>
      (weight(b.status) - weight(a.status)) || (pri(a.name) - pri(b.name))));
  }

  for (const idx of ranked) {
    if (cards.length >= 4) break;
    let svg: string | null = null;
    let wide = false;
    if (/^egfr$/i.test(idx.name)) svg = renderEgfrStepsCard(idx, byKey, patient, warn);
    if (!svg && /mentzer/i.test(idx.name)) {
      svg = renderMentzerFlowCard(idx, byKey, warn);
      wide = Boolean(svg);
    }
    if (!svg) svg = renderCalcBandsCard(idx, byKey, patient, warn);
    if (svg) {
      cards.push({ title: idx.name, svg, wide: wide || undefined });
      used.add(idx);
    }
  }
  return { cards, used };
}

function buildReportViewModel(
  data: ExtractedReport,
  input: GenerateRequest,
  calculations?: CalculationsResult,
  routing?: DiagramRouting | null,
): ReportViewModel {
  const sections = data.test_sections || [];
  const patient = data.patient || {};
  const lab = data.lab_info || {};
  const summary = data.patient_summary || null;
  const language = getTargetLanguage(input.summary_language);

  const classified: Array<{ section: string; test: ExtractedTest; cls: TestClassification }> = [];
  sections.forEach((section, index) => {
    const name = section.section_name || `Section ${index + 1}`;
    for (const test of section.tests || []) {
      classified.push({ section: name, test, cls: classifyTest(test) });
    }
  });

  const counts = { total: classified.length, normal: 0, high: 0, low: 0, critical: 0, unclassified: 0 };
  for (const row of classified) {
    if (row.cls === 'normal') counts.normal++;
    else if (row.cls === 'high') counts.high++;
    else if (row.cls === 'low') counts.low++;
    else if (row.cls === 'critical') counts.critical++;
    else counts.unclassified++;
  }

  // Panels are built first so the tables can show only what no panel does.
  // A skipped panel marks nothing as used, so its rows stay in the tables.
  const { diagrams, used: panelTests } = buildDiagrams(classified, patient.sex, calculations, routing?.slots ?? null);

  // Logic cards for the few indices that matter most on this report. The
  // rest stay in the indices table below, which carries the formula column.
  const { cards: calcCards, used: cardedIndices } = buildCalcCards(calculations, classified, patient, routing?.calcTop);

  const viewSections = sections.map((section, index) => {
    const name = section.section_name || `Section ${index + 1}`;
    const rows = classified.filter((row) => row.section === name);
    const flaggedRows = rows.filter((row) => row.cls === 'high' || row.cls === 'low' || row.cls === 'critical');
    return {
      name,
      category: section.category || '',
      flagged: flaggedRows.length,
      tested: rows.length,
      accent: sectionAccent(flaggedRows.length, rows.some((row) => row.cls === 'critical')),
      // Only the rows no panel above already displays. Counts stay based on
      // the full section, because they describe the report, not this table.
      rows: rows.filter((row) => !panelTests.has(row.test)).map((row) => {
        const bounds = parseReferenceBounds(row.test.reference_range, patient.sex);
        const numeric = parseNumericValue(row.test.value);
        return {
          test: row.test.test_name,
          value: row.test.value,
          unit: row.test.unit && row.test.unit !== 'not available' ? row.test.unit : '',
          flag: compactSourceFlag(row.test.source_flag),
          range: hasUsableRange(row.test.reference_range) ? String(row.test.reference_range) : 'not available',
          cls: row.cls,
          numeric: numeric ?? undefined,
          low: bounds?.low,
          high: bounds?.high,
        };
      }),
    };
  });

  const noteByTest = new Map<string, string>();
  for (const finding of summary?.abnormal_findings || []) {
    if (finding.test_name && finding.explanation) {
      noteByTest.set(finding.test_name.trim().toLowerCase(), finding.explanation);
    }
  }

  const abnormal = classified
    .filter((row) => row.cls === 'high' || row.cls === 'low' || row.cls === 'critical')
    .map((row) => {
      const bounds = parseReferenceBounds(row.test.reference_range, patient.sex);
      const numeric = parseNumericValue(row.test.value);
      const note = noteByTest.get(row.test.test_name.trim().toLowerCase()) || '';
      return {
        section: row.section,
        test: row.test.test_name,
        value: row.test.value,
        unit: row.test.unit && row.test.unit !== 'not available' ? row.test.unit : '',
        pill: row.cls.toUpperCase(),
        cls: row.cls,
        range: hasUsableRange(row.test.reference_range)
          ? String(row.test.reference_range)
          : 'Flagged by lab \u00B7 range not printed',
        note: note.length > 170 ? `${note.slice(0, 167)}...` : note,
        numeric: numeric ?? undefined,
        low: bounds?.low,
        high: bounds?.high,
      };
    });

  const markers: ReportViewModel['markers'] = [];
  for (const row of classified) {
    if (markers.length >= 12) break;
    if (!row.test.canonical_key || !KEY_MARKER_KEYS.has(String(row.test.canonical_key))) continue;
    const bounds = parseReferenceBounds(row.test.reference_range, patient.sex);
    const numeric = parseNumericValue(row.test.value);
    if (numeric === null) continue;
    // Spotlight-eligible analytes (e.g. vitamin D with a textual range like
    // "INSUFFICIENCY : 20-<30") keep their spotlight chart even when the
    // printed range cannot be parsed into bounds; the spotlight zones come
    // from the template's clinical config, not from the lab range.
    if (!bounds && !SPOTLIGHT_KEYS.has(String(row.test.canonical_key))) continue;
    markers.push({
      key: String(row.test.canonical_key),
      name: row.test.test_name,
      unit: row.test.unit && row.test.unit !== 'not available' ? row.test.unit : '',
      numeric,
      low: bounds?.low,
      high: bounds?.high,
      rangeText: String(row.test.reference_range),
      cls: row.cls,
    });
  }

  // Composite scores render as gauges; 0-100 individual indices (such as the
  // Longevity Score, which arrives as an individual index) are promoted too.
  const composites: ReportViewModel['composites'] = (calculations?.composite_scores || [])
    .filter((score) => score.grade !== 'N/A')
    .map((score) => ({ name: score.name, score: score.score, grade: score.grade, interpretation: score.interpretation }));
  // Tests the lab printed itself, for deduplication below. Shown twice, a
  // ratio can carry two verdicts: our BUN/Creatinine 9.3 LOW against a
  // standard 10-20 sat five pages from the lab's printed 9.34 against its
  // own 9-23, unflagged. The lab's row wins - it is on the page with its
  // own reference - and the calculated copy stays out of the indices table.
  // (Calculations keep the value: diagrams and prompts still use it.)
  const printedNames = new Set(
    classified.map((row) => row.test.test_name.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );

  const indices: ReportViewModel['indices'] = [];
  for (const idx of calculations?.individual_indices || []) {
    // An index shown as a logic card above is not repeated in the table.
    if (cardedIndices.has(idx)) continue;
    if (printedNames.has(idx.name.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    const numericValue = typeof idx.value === 'number' ? idx.value : Number(idx.value);
    if (idx.unit === '/100' && Number.isFinite(numericValue)) {
      composites.push({ name: idx.name, score: numericValue, grade: '', interpretation: idx.interpretation });
      continue;
    }
    indices.push({
      name: idx.name,
      value: `${idx.value}${idx.unit ? ` ${idx.unit}` : ''}`,
      status: idx.status,
      interpretation: idx.interpretation,
      reference: idx.reference_range || 'not available',
      formula: idx.formula,
    });
  }

  // WBC differential percentages (raw, as printed) for the composition bar.
  const DIFFERENTIAL_VIEW_KEYS = new Set(['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils']);
  const differential: NonNullable<ReportViewModel['differential']> = [];
  for (const row of classified) {
    const key = String(row.test.canonical_key || '');
    if (!DIFFERENTIAL_VIEW_KEYS.has(key)) continue;
    const numeric = parseNumericValue(row.test.value);
    const unit = (row.test.unit || '').trim();
    if (numeric === null || numeric > 100) continue;
    if (unit && !unit.includes('%')) continue;
    differential.push({ name: row.test.test_name, pct: numeric, cls: row.cls });
  }

  const questions = Array.from(
    new Set((summary?.abnormal_findings || []).map((finding) => (finding.what_to_do || '').trim()).filter(Boolean)),
  ).slice(0, 6);
  if (summary?.consultation_recommendation) questions.push(summary.consultation_recommendation);

  return {
    // Deep sage, matching the report palette (report-template.ts C.greenText).
    // Becomes a per-tenant value once clinic branding is stored; white header
    // text needs a colour at least this dark to stay legible.
    brandColor: '#3C5A3C',
    labName: lab.name || 'Smart Health Reports',
    patient: {
      name: patient.name || input.patient_name || 'not available',
      ageSex: `${patient.age || 'not available'} / ${patient.sex || 'not available'}`,
      reportDate: patient.report_date || 'not available',
      doctor: patient.doctor_name || 'not available',
      reportType: REPORT_TYPE_LABELS[input.report_type] || input.report_type,
      language: language.name,
    },
    overallStatus: [summary?.health_status, summary?.summary_message].filter(Boolean).join(' '),
    summaryMessage: summary?.summary_message || '',
    counts,
    // Every section stays in the model - the page-1 domain tiles and the
    // attention list need the full set with true tested/flagged counts.
    // The tables block skips sections whose rows were all taken by panels.
    sections: viewSections,
    abnormal,
    markers,
    differential: differential.length >= 2 ? differential : undefined,
    indices,
    composites,
    diagrams,
    calcCards: calcCards.length ? calcCards : undefined,
    tablesFiltered: panelTests.size > 0,
    notCalculated: (calculations?.not_calculated_indices || []).slice(0, 8).map((idx) => idx.name),
    questions,
    tips: (summary?.health_tips || []).slice(0, 3),
    normalFindings: (summary?.normal_findings_detailed || []).slice(0, 6).map((item) => ({
      test: item.test_name,
      value: item.value,
      meaning: item.your_result_means,
    })),
  };
}

async function generateFallbackPdfWithPdfCo(
  data: ExtractedReport,
  input: GenerateRequest,
  calculations?: CalculationsResult,
  routing?: DiagramRouting | null,
) {
  const apiKey = Deno.env.get('PDFCO_API_KEY');
  if (!apiKey) {
    throw new Error('Configure GAMMA_API_KEY or PDFCO_API_KEY to generate Smart Report PDFs');
  }

  const viewModel = buildReportViewModel(data, input, calculations, routing);

  const response = await runtimeFetch('https://api.pdf.co/v1/pdf/convert/from/html', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      html: renderReportHtml(viewModel),
      footer: renderReportFooterHtml(viewModel),
      name: `smart-report-${input.request_id}.pdf`,
      paperSize: 'A4',
      margins: PDFCO_PAGE_MARGINS,
      async: false,
      printBackground: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF.co HTML-to-PDF error ${response.status}: ${text}`);
  }

  const result = await response.json();
  if (result.error || !result.url) {
    throw new Error(result.message || 'PDF.co did not return a PDF URL');
  }

  return result.url as string;
}

async function uploadPdfToStorage(supabase: any, requestId: string, patientName: string, pdfBytes: ArrayBuffer | Uint8Array) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `smart-reports/${requestId}/${sanitizeFilePart(patientName)}-${timestamp}.pdf`;
  const { error } = await supabase.storage
    .from('reports')
    .upload(filename, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`Failed to upload generated PDF: ${error.message}`);

  const { data } = supabase.storage.from('reports').getPublicUrl(filename);
  return data.publicUrl;
}

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

/**
 * The full generation pipeline, run AFTER the HTTP response has been sent.
 * End to end it takes 2-4 minutes (Claude extraction ~1 min, patient summary
 * ~30s, Gamma generation up to 2 min), while the platform kills a held-open
 * request at 150s with IDLE_TIMEOUT - which used to leave rows stuck in
 * "processing" even though Gamma had finished the document. The pipeline owns
 * the terminal status: it marks the request completed or failed itself.
 */
type ServiceClient = ReturnType<typeof createClient<any, 'public', any>>;

async function runGenerationPipeline(
  serviceClient: ServiceClient,
  parsedInput: GenerateRequest,
): Promise<void> {
  try {
    const pdfBuffers: ArrayBuffer[] = [];
    for (const url of parsedInput.uploaded_report_urls) {
      if (!url.toLowerCase().includes('.pdf')) continue;
      logStage('download_pdf_start', { url });
      const response = await runtimeFetch(url);
      if (!response.ok) throw new Error(`Failed to download uploaded report: ${response.status} ${response.statusText}`);
      pdfBuffers.push(await response.arrayBuffer());
      logStage('download_pdf_done', { url, pdf_count: pdfBuffers.length });
    }

    if (pdfBuffers.length === 0) {
      throw new Error('Smart report generation currently requires at least one uploaded PDF file');
    }

    let extractedData: ExtractedReport;
    let extractionWarning: string | null = null;
    let summaryWarning: string | null = null;
    try {
      logStage('claude_extract_start', { pdf_count: pdfBuffers.length });
      extractedData = await extractWithClaude(pdfBuffers);
      logStage('claude_extract_done', {
        sections: extractedData.test_sections?.length || 0,
        abnormal_count: extractedData.abnormal_summary?.length || 0,
      });
    } catch (error) {
      extractionWarning = error instanceof Error ? error.message : 'AI extraction failed';
      console.warn('[generate-pathology-infographic] Claude extraction warning:', extractionWarning);
      // Without extraction there are no lab values: generating anyway would
      // produce (and possibly auto-send) an empty report marked "completed".
      // Fail the request instead so the problem is visible.
      throw new Error(`Report extraction failed, request aborted before generation: ${extractionWarning}`);
    }

    try {
      logStage('patient_summary_start', {
        language: parsedInput.summary_language || 'en',
        target_language: getTargetLanguage(parsedInput.summary_language).name,
      });
      extractedData.patient_summary = await generatePatientSummaryWithClaude(extractedData, parsedInput);
      logStage('patient_summary_done', {
        language: extractedData.patient_summary?.language || parsedInput.summary_language || 'en',
        normal_count: extractedData.patient_summary?.normal_findings_detailed?.length || 0,
        abnormal_count: extractedData.patient_summary?.abnormal_findings?.length || 0,
      });
    } catch (error) {
      summaryWarning = error instanceof Error ? error.message : 'Patient summary generation failed';
      console.warn('[generate-pathology-infographic] Patient summary warning:', summaryWarning);
    }

    // Calculate clinical indices and composite scores
    let calculations: CalculationsResult | undefined;
    let calculationsWarning: string | null = null;
    try {
      logStage('clinical_calculations_start', {
        has_biometrics: Boolean(parsedInput.biometrics),
        report_type: parsedInput.report_type,
      });

      // Extract lab values from parsed report data
      const labValues = extractLabValuesFromReport(extractedData);
      const mappingStats = (labValues as ExtractedLabValues & {
        __mapping_stats?: {
          ai_mapped_count: number;
          fallback_mapped_count: number;
          unmapped_numeric_count: number;
        };
      }).__mapping_stats;
      const biometrics = parsedInput.biometrics || {};

      logStage('lab_values_extracted', {
        extracted_values_count: Object.keys(labValues).filter((k) =>
          k !== '__mapping_stats' && labValues[k as keyof ExtractedLabValues] !== undefined
        ).length,
        ai_mapped_count: mappingStats?.ai_mapped_count || 0,
        fallback_mapped_count: mappingStats?.fallback_mapped_count || 0,
        unmapped_numeric_count: mappingStats?.unmapped_numeric_count || 0,
        has_age: Boolean(labValues.age),
        has_sex: Boolean(labValues.sex),
      });

      // Calculate individual indices and keep diagnostics for missing inputs.
      const allIndividualIndices = calculateAllIndices(labValues, biometrics);
      const individualIndices = allIndividualIndices.filter((idx) => idx.status !== 'not_calculated');
      const notCalculatedIndices = allIndividualIndices.filter((idx) => idx.status === 'not_calculated');

      // Calculate composite scores (especially for longevity reports)
      const compositeScores = parsedInput.report_type === 'longitivity_report'
        ? getCalculableCompositeScores(labValues, biometrics)
        : [];

      calculations = {
        individual_indices: individualIndices,
        not_calculated_indices: notCalculatedIndices,
        composite_scores: compositeScores,
      };

      logStage('clinical_calculations_done', {
        individual_indices_count: individualIndices.length,
        not_calculated_indices_count: notCalculatedIndices.length,
        composite_scores_count: compositeScores.length,
      });

      // Save calculated indices to database
      if (individualIndices.length > 0 || compositeScores.length > 0) {
        await serviceClient
          .from('report_requests')
          .update({
            calculated_indices: calculations,
            updated_at: new Date().toISOString(),
          })
          .eq('id', parsedInput.request_id);
      }
    } catch (error) {
      calculationsWarning = error instanceof Error ? error.message : 'Clinical calculations failed';
      console.warn('[generate-pathology-infographic] Clinical calculations warning:', calculationsWarning);
    }

    // AI slot mapping for the panels whose rows have no canonical key.
    // Failure costs nothing: every slot has a deterministic regex fallback.
    let diagramSlotMap: DiagramRouting | null = null;
    try {
      diagramSlotMap = await buildDiagramSlotMapWithAI(extractedData, calculations);
      logStage('slot_map_done', {
        mapped: diagramSlotMap ? Object.keys(diagramSlotMap.slots).length : 0,
        slots: diagramSlotMap?.slots,
        calc_top: diagramSlotMap?.calcTop,
      });
    } catch (error) {
      logStage('slot_map_failed', { message: error instanceof Error ? error.message : String(error) });
    }

    const layoutPrompt = buildCompactLayoutPrompt(extractedData, parsedInput, calculations);
    // Renderer selection. REPORT_PRIMARY_RENDERER secret: 'html' (default)
    // renders the in-house HTML report via PDF.co with Gamma as fallback;
    // 'gamma' restores Gamma-first with PDF.co as fallback. Flip it with
    //   npx supabase secrets set REPORT_PRIMARY_RENDERER=gamma
    // - no code change or redeploy needed. The Gamma layout prompt is built
    // either way, so both paths always stay ready.
    const primaryRenderer = (Deno.env.get('REPORT_PRIMARY_RENDERER') || 'html').toLowerCase();
    logStage('renderer_selected', { primary: primaryRenderer });

    let generatedUrl: string | null = null;
    let generationWarning: string | null = null;

    if (primaryRenderer === 'gamma') {
      try {
        logStage('gamma_generation_start', { layout_chars: layoutPrompt.length });
        generatedUrl = await generateWithGamma(layoutPrompt);
        logStage('gamma_generation_done', { generated_url: generatedUrl });
      } catch (error) {
        generationWarning = error instanceof Error ? error.message : 'Gamma generation failed';
        console.warn('[generate-pathology-infographic] Gamma generation warning:', generationWarning);
      }

      if (!generatedUrl) {
        logStage('pdfco_fallback_start');
        generatedUrl = await generateFallbackPdfWithPdfCo(extractedData, parsedInput, calculations, diagramSlotMap);
        logStage('pdfco_fallback_done', { generated_url: generatedUrl });
      }
    } else {
      try {
        logStage('pdfco_primary_start');
        generatedUrl = await generateFallbackPdfWithPdfCo(extractedData, parsedInput, calculations, diagramSlotMap);
        logStage('pdfco_primary_done', { generated_url: generatedUrl });
      } catch (error) {
        generationWarning = error instanceof Error ? error.message : 'PDF.co generation failed';
        console.warn('[generate-pathology-infographic] PDF.co generation warning:', generationWarning);
      }

      if (!generatedUrl) {
        logStage('gamma_fallback_start', { layout_chars: layoutPrompt.length });
        generatedUrl = await generateWithGamma(layoutPrompt);
        logStage('gamma_fallback_done', { generated_url: generatedUrl });
        if (!generatedUrl) {
          throw new Error('Both PDF.co and Gamma renderers failed to produce a report PDF');
        }
      }
    }

    generatedUrl = await addFirstAndLastBrandedPages(generatedUrl, extractedData, parsedInput);

    logStage('download_generated_pdf_start', { generated_url: generatedUrl });
    const generatedPdf = await runtimeFetch(generatedUrl);
    if (!generatedPdf.ok) {
      throw new Error(`Failed to download generated PDF: ${generatedPdf.status} ${generatedPdf.statusText}`);
    }
    const generatedBytes = await generatedPdf.arrayBuffer();
    logStage('upload_generated_pdf_start', { bytes: generatedBytes.byteLength });
    generatedUrl = await uploadPdfToStorage(serviceClient, parsedInput.request_id, parsedInput.patient_name, generatedBytes);
    logStage('upload_generated_pdf_done', { generated_url: generatedUrl });

    await serviceClient
      .from('report_requests')
      .update({
        status: 'completed',
        generated_report_url: generatedUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsedInput.request_id);
    logStage('request_completed', { request_id: parsedInput.request_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[generate-pathology-infographic] Pipeline error:', {
      request_id: parsedInput.request_id,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    await serviceClient
      .from('report_requests')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', parsedInput.request_id);
  }
}

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: 'Supabase function secrets are not configured' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  try {
    const parsedInput = await req.json() as GenerateRequest;
    logStage('request_received', {
      request_id: parsedInput.request_id,
      patient_name: parsedInput.patient_name,
      report_type: parsedInput.report_type,
      uploaded_count: parsedInput.uploaded_report_urls?.length || 0,
      has_letterhead: Boolean(parsedInput.letterhead_url),
      has_biometrics: Boolean(parsedInput.biometrics),
      has_anthropic_key: Boolean(Deno.env.get('ANTHROPIC_API_KEY')),
      has_gamma_key: Boolean(Deno.env.get('GAMMA_API_KEY')),
      has_pdfco_key: Boolean(Deno.env.get('PDFCO_API_KEY')),
      has_service_key: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
    });

    if (!parsedInput.request_id) return jsonResponse({ success: false, error: 'request_id is required' }, 400);
    if (!parsedInput.uploaded_report_urls?.length) return jsonResponse({ success: false, error: 'At least one uploaded report URL is required' }, 400);

    logStage('mark_processing', { request_id: parsedInput.request_id });
    await serviceClient.from('report_requests').update({ status: 'processing' }).eq('id', parsedInput.request_id);

    // Respond now, finish in the background. EdgeRuntime.waitUntil keeps the
    // worker alive past the response, up to the worker wall-clock limit.
    const pipeline = runGenerationPipeline(serviceClient, parsedInput);
    if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime?.waitUntil === 'function') {
      EdgeRuntime.waitUntil(pipeline);
    } else {
      // Local/older runtime: let it run detached (config.toml sets
      // edge_runtime.policy = "per_worker" so the worker is not torn down).
      pipeline.catch((error) => {
        console.error('[generate-pathology-infographic] Detached pipeline error:', error);
      });
    }

    logStage('request_accepted', { request_id: parsedInput.request_id });
    return jsonResponse({
      success: true,
      accepted: true,
      request_id: parsedInput.request_id,
      status: 'processing',
      message: 'Smart Report generation is running in the background. The request status updates when it finishes.',
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[generate-pathology-infographic] Request error:', { message });
    return jsonResponse({ success: false, error: message }, 400);
  }
}, 'growth', 'generate-pathology-infographic'));
