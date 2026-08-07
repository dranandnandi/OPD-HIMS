import { ExaminationField, ExaminationSection, PhysicalExamination } from '../types';

/**
 * Shared AI → EMR mapping layer.
 *
 * Every AI source that feeds the visit form (voice dictation, case-paper OCR,
 * in-visit image analysis) produces slightly different JSON. This module gives
 * all of them one canonical shape (`EmrExtraction`), one examination target
 * schema, and one merge routine — so a finding can never be dropped just
 * because it arrived from a different pipeline or because no examination
 * template happened to be loaded.
 */

// ─── Default examination schema ────────────────────────────────────────────
// Used as the AI's mapping target whenever the doctor has NOT loaded a
// template. Without this the AI has no field keys to aim at and every
// examination finding is silently discarded.

export const DEFAULT_EXAMINATION_SECTIONS: ExaminationSection[] = [
  {
    id: 'general',
    title: 'General Examination',
    fields: [
      { key: 'generalCondition', label: 'General Condition', type: 'text', value: '', placeholder: 'e.g. Fair, conscious, oriented' },
      { key: 'pallor', label: 'Pallor', type: 'select', value: '', options: ['Absent', 'Present', 'Not examined'] },
      { key: 'icterus', label: 'Icterus', type: 'select', value: '', options: ['Absent', 'Present', 'Not examined'] },
      { key: 'cyanosis', label: 'Cyanosis', type: 'select', value: '', options: ['Absent', 'Present', 'Not examined'] },
      { key: 'clubbing', label: 'Clubbing', type: 'select', value: '', options: ['Absent', 'Present', 'Not examined'] },
      { key: 'lymphadenopathy', label: 'Lymphadenopathy', type: 'select', value: '', options: ['Absent', 'Present', 'Not examined'] },
      { key: 'edema', label: 'Oedema', type: 'select', value: '', options: ['Absent', 'Present', 'Not examined'] },
      { key: 'generalNotes', label: 'Other General Findings', type: 'textarea', value: '', placeholder: 'Any other general findings' },
    ],
  },
  {
    id: 'cardiovascular',
    title: 'Cardiovascular System (CVS)',
    fields: [
      { key: 'heartSounds', label: 'Heart Sounds', type: 'text', value: '', placeholder: 'e.g. S1 S2 normal' },
      { key: 'murmurs', label: 'Murmurs', type: 'text', value: '', placeholder: 'e.g. No murmur' },
      { key: 'cvsNotes', label: 'Other CVS Findings', type: 'textarea', value: '' },
    ],
  },
  {
    id: 'respiratory',
    title: 'Respiratory System (RS)',
    fields: [
      { key: 'breathSounds', label: 'Breath Sounds', type: 'text', value: '', placeholder: 'e.g. Bilateral air entry equal' },
      { key: 'addedSounds', label: 'Added Sounds (crepitations / wheeze)', type: 'text', value: '' },
      { key: 'respiratoryNotes', label: 'Other Respiratory Findings', type: 'textarea', value: '' },
    ],
  },
  {
    id: 'abdomen',
    title: 'Per Abdomen (P/A)',
    fields: [
      { key: 'tenderness', label: 'Tenderness', type: 'text', value: '' },
      { key: 'organomegaly', label: 'Organomegaly', type: 'text', value: '' },
      { key: 'bowelSounds', label: 'Bowel Sounds', type: 'text', value: '' },
      { key: 'abdomenNotes', label: 'Other Abdominal Findings', type: 'textarea', value: '' },
    ],
  },
  {
    id: 'neurological',
    title: 'Central Nervous System (CNS)',
    fields: [
      { key: 'consciousness', label: 'Higher Functions / Consciousness', type: 'text', value: '' },
      { key: 'motor', label: 'Motor System', type: 'text', value: '' },
      { key: 'sensory', label: 'Sensory System', type: 'text', value: '' },
      { key: 'reflexes', label: 'Reflexes', type: 'text', value: '' },
      { key: 'neurologicalNotes', label: 'Other Neurological Findings', type: 'textarea', value: '' },
    ],
  },
  {
    id: 'localExamination',
    title: 'Local Examination',
    fields: [
      { key: 'inspection', label: 'Inspection', type: 'textarea', value: '' },
      { key: 'palpation', label: 'Palpation', type: 'textarea', value: '' },
      { key: 'localNotes', label: 'Other Local Findings', type: 'textarea', value: '' },
    ],
  },
  {
    id: 'other',
    title: 'Other Findings',
    fields: [
      { key: 'otherFindings', label: 'Other Systemic Findings', type: 'textarea', value: '' },
    ],
  },
];

/** Deep clone of the default schema with all values blank. */
export const createDefaultExamination = (): PhysicalExamination => ({
  sections: DEFAULT_EXAMINATION_SECTIONS.map(section => ({
    ...section,
    fields: section.fields.map(field => ({ ...field, value: field.type === 'toggle' ? false : '' })),
  })),
  aiGenerated: false,
});

export interface ExaminationSchemaForAI {
  isTemplate: boolean;
  templateName?: string;
  sections: Array<{
    id: string;
    title: string;
    fields: Array<{ key: string; label: string; type: ExaminationField['type']; options?: string[] }>;
  }>;
}

/**
 * The examination field list handed to the AI as its mapping target.
 * Uses the doctor's loaded template when present, the default schema otherwise,
 * so the AI always has concrete keys to fill.
 */
export const buildExaminationSchemaForAI = (
  examination?: PhysicalExamination
): ExaminationSchemaForAI => {
  const isTemplate = Boolean(examination?.sections?.length);
  const sections = isTemplate ? examination!.sections : DEFAULT_EXAMINATION_SECTIONS;

  return {
    isTemplate,
    templateName: examination?.templateName,
    sections: sections.map(section => ({
      id: section.id,
      title: section.title,
      fields: (section.fields || []).map(field => ({
        key: field.key,
        label: field.label,
        type: field.type,
        ...(field.options?.length ? { options: field.options } : {}),
      })),
    })),
  };
};

// ─── Canonical extraction shape ────────────────────────────────────────────

export interface ExtractedSymptom {
  name: string;
  severity?: 'mild' | 'moderate' | 'severe' | null;
  duration?: string | null;
  location?: string | null;
  pattern?: string | null;
  character?: string | null;
  associatedSymptoms?: string[] | string | null;
  aggravatingFactors?: string | null;
  relievingFactors?: string | null;
  notes?: string | null;
}

export interface ExtractedDiagnosis {
  name: string;
  icd10Code?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface ExtractedPrescription {
  medicine: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  route?: string | null;
  quantity?: number | null;
  refills?: number | null;
}

export interface ExtractedTest {
  testName: string;
  testType?: string | null;
  urgency?: string | null;
  instructions?: string | null;
}

export interface UnmappedFinding {
  label: string;
  value: string;
}

export interface EmrExtraction {
  chiefComplaint?: string | null;
  symptoms: ExtractedSymptom[];
  vitals: {
    temperature?: string | null;
    bloodPressure?: string | null;
    pulse?: string | null;
    weight?: string | null;
    height?: string | null;
    respiratoryRate?: string | null;
    oxygenSaturation?: string | null;
  };
  examination?: Record<string, unknown> | null;
  diagnoses: ExtractedDiagnosis[];
  suggestedDiagnoses: Array<{ name: string; likelihood?: string | null; reasoning?: string | null }>;
  prescriptions: ExtractedPrescription[];
  testsOrdered: ExtractedTest[];
  advice: string[];
  followUp?: {
    duration?: string | null;
    instructions?: string | null;
    warningSignsToWatch?: string[] | null;
  } | null;
  doctorNotes?: string | null;
  unmappedFindings: UnmappedFinding[];
  transcript?: string | null;
}

// ─── Value helpers ─────────────────────────────────────────────────────────

const BLANK_TOKENS = new Set([
  '', '-', '--', 'null', 'undefined', 'n/a', 'na', 'nil value', 'not mentioned',
  'not stated', 'not specified', 'not assessed', 'not applicable', 'not available',
  'unknown', 'none mentioned', 'not discussed', 'not examined yet',
]);

const isBlank = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.every(isBlank);
  const text = String(value).trim().toLowerCase();
  return BLANK_TOKENS.has(text);
};

const asText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.filter(v => !isBlank(v)).map(asText).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => !isBlank(v))
      .map(([k, v]) => `${humanizeKey(k)}: ${asText(v)}`)
      .join('; ');
  }
  return String(value).trim();
};

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const humanizeKey = (key: string): string =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase());

const ROMAN_NUMERALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5',
  vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};

/**
 * Comparable tokens for a select option or an AI value.
 * Roman numerals are folded to digits so "grade 3" matches "Grade III" — and,
 * just as importantly, "Grade IX" does NOT match "Grade I".
 */
const optionTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(token => ROMAN_NUMERALS[token] ?? token);

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'present', 'positive', '+', '++', '1', 'seen', 'noted', 'detected', 'positive finding']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'absent', 'negative', '-', '0', 'nil', 'none', 'not present', 'nad', 'normal', 'within normal limits', 'wnl']);

/**
 * Coerce an AI value into something the field's input control can actually
 * render. Returns `ok: false` when the value cannot be represented, so the
 * caller can divert it to notes instead of dropping (or, worse, mis-rendering
 * "absent" as a checked toggle).
 */
export const coerceFieldValue = (
  field: ExaminationField,
  raw: unknown
): { value: string | boolean; ok: boolean } => {
  if (field.type === 'toggle') {
    if (typeof raw === 'boolean') return { value: raw, ok: true };
    const text = asText(raw).toLowerCase();
    if (TRUE_WORDS.has(text)) return { value: true, ok: true };
    if (FALSE_WORDS.has(text)) return { value: false, ok: true };
    return { value: false, ok: false };
  }

  if (field.type === 'select' && field.options?.length) {
    const text = asText(raw);
    const valueTokens = optionTokens(text);
    const exact = field.options.find(
      option => optionTokens(option).join(' ') === valueTokens.join(' ')
    );
    if (exact) return { value: exact, ok: true };

    // Boolean-ish answers against Present/Absent style option lists
    const lower = text.toLowerCase();
    if (TRUE_WORDS.has(lower) || FALSE_WORDS.has(lower)) {
      const wanted = TRUE_WORDS.has(lower) ? ['present', 'yes', 'positive', 'abnormal'] : ['absent', 'no', 'negative', 'normal'];
      const match = field.options.find(option => wanted.includes(option.toLowerCase()));
      if (match) return { value: match, ok: true };
    }

    // Whole-token containment only. Substring matching would map "Grade IX"
    // onto "Grade I" — a wrong value is worse than an unmapped one.
    const valueTokenSet = new Set(valueTokens);
    const partial = field.options.filter(option => {
      const tokens = optionTokens(option);
      return tokens.length > 0 && tokens.every(token => valueTokenSet.has(token));
    });
    if (partial.length === 1) return { value: partial[0], ok: true };

    return { value: '', ok: false };
  }

  return { value: asText(raw), ok: true };
};

// ─── Examination mapping ───────────────────────────────────────────────────

interface FieldRef {
  sectionIndex: number;
  fieldIndex: number;
  field: ExaminationField;
  sectionId: string;
  sectionTitle: string;
}

const registerAlias = (index: Map<string, FieldRef[]>, alias: string, ref: FieldRef) => {
  const key = normalizeKey(alias);
  if (!key) return;
  const bucket = index.get(key);
  if (bucket) bucket.push(ref);
  else index.set(key, [ref]);
};

/** Leaf entries of the AI examination object, keeping the path for labelling. */
const flattenExamination = (
  value: unknown,
  path: string[] = [],
  depth = 0
): Array<{ path: string[]; key: string; value: unknown }> => {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value !== 'object' || Array.isArray(value)) {
    return path.length ? [{ path, key: path[path.length - 1], value }] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenExamination(child, [...path, key], depth + 1)
  );
};

/**
 * Write AI examination findings onto the loaded template (or default schema).
 * Anything that has no home — an unknown key, an out-of-range select value,
 * an ambiguous toggle — comes back in `unmapped` so the caller can park it in
 * doctor notes rather than lose it.
 */
export const applyExaminationFindings = (
  sections: ExaminationSection[],
  aiExamination: Record<string, unknown> | null | undefined
): { sections: ExaminationSection[]; unmapped: UnmappedFinding[] } => {
  if (!aiExamination || typeof aiExamination !== 'object') {
    return { sections, unmapped: [] };
  }

  const working: ExaminationSection[] = sections.map(section => ({
    ...section,
    fields: section.fields.map(field => ({ ...field })),
  }));

  const fieldIndex = new Map<string, FieldRef[]>();
  const sectionCatchAll = new Map<string, FieldRef>();

  working.forEach((section, sectionIndex) => {
    section.fields.forEach((field, fieldIndex_) => {
      const ref: FieldRef = {
        sectionIndex,
        fieldIndex: fieldIndex_,
        field,
        sectionId: section.id,
        sectionTitle: section.title,
      };
      registerAlias(fieldIndex, field.key, ref);
      registerAlias(fieldIndex, field.label, ref);
      registerAlias(fieldIndex, `${section.id}${field.key}`, ref);
      registerAlias(fieldIndex, `${section.title}${field.label}`, ref);
    });

    // Free-text sink for a whole section (used when the AI returns
    // "general": "…prose…" instead of per-field values). A notes/other field is
    // the right home for prose; a specific field like "Inspection" is not.
    const isNotesField = (f: ExaminationField) =>
      /notes?|other|finding|remark|comment/i.test(`${f.key} ${f.label}`);
    const freeText = section.fields.filter(f => f.type === 'textarea' || f.type === 'text');
    const catchAll =
      freeText.filter(isNotesField).pop() ||
      freeText.filter(f => f.type === 'textarea').pop() ||
      freeText[freeText.length - 1] ||
      section.fields[section.fields.length - 1];

    if (catchAll) {
      const ref: FieldRef = {
        sectionIndex,
        fieldIndex: section.fields.indexOf(catchAll),
        field: catchAll,
        sectionId: section.id,
        sectionTitle: section.title,
      };
      sectionCatchAll.set(normalizeKey(section.id), ref);
      sectionCatchAll.set(normalizeKey(section.title), ref);
    }
  });

  const unmapped: UnmappedFinding[] = [];
  const written = new Set<string>();

  const write = (ref: FieldRef, raw: unknown, label: string): boolean => {
    const target = working[ref.sectionIndex].fields[ref.fieldIndex];
    const { value, ok } = coerceFieldValue(target, raw);
    if (!ok) {
      unmapped.push({ label, value: asText(raw) });
      return false;
    }

    const slot = `${ref.sectionIndex}:${ref.fieldIndex}`;
    if (written.has(slot) && target.type !== 'toggle') {
      // Two AI keys landed on one field — append rather than overwrite.
      const existing = asText(target.value);
      const addition = asText(value);
      if (existing && addition && !existing.toLowerCase().includes(addition.toLowerCase())) {
        working[ref.sectionIndex].fields[ref.fieldIndex] = { ...target, value: `${existing}; ${addition}` };
        return true;
      }
    }

    working[ref.sectionIndex].fields[ref.fieldIndex] = { ...target, value };
    written.add(slot);
    return true;
  };

  const resolve = (leafKey: string, parentKey?: string): FieldRef | null => {
    const scoped = parentKey ? fieldIndex.get(normalizeKey(`${parentKey}${leafKey}`)) : undefined;
    if (scoped?.length) {
      if (parentKey) {
        const inSection = scoped.find(ref => normalizeKey(ref.sectionId) === normalizeKey(parentKey));
        if (inSection) return inSection;
      }
      return scoped[0];
    }

    const direct = fieldIndex.get(normalizeKey(leafKey));
    if (direct?.length) {
      if (parentKey) {
        const inSection = direct.find(
          ref =>
            normalizeKey(ref.sectionId) === normalizeKey(parentKey) ||
            normalizeKey(ref.sectionTitle) === normalizeKey(parentKey)
        );
        if (inSection) return inSection;
      }
      return direct[0];
    }

    // Last resort: unique substring match on a field key/label.
    const target = normalizeKey(leafKey);
    if (target.length >= 4) {
      const candidates: FieldRef[] = [];
      fieldIndex.forEach((refs, alias) => {
        if (alias.includes(target) || target.includes(alias)) candidates.push(...refs);
      });
      const unique = new Map(candidates.map(ref => [`${ref.sectionIndex}:${ref.fieldIndex}`, ref]));
      if (unique.size === 1) return [...unique.values()][0];
    }

    return null;
  };

  for (const leaf of flattenExamination(aiExamination)) {
    if (isBlank(leaf.value)) continue;

    const parentKey = leaf.path.length > 1 ? leaf.path[leaf.path.length - 2] : undefined;
    const label = leaf.path.map(humanizeKey).join(' › ');

    const ref = resolve(leaf.key, parentKey);
    if (ref) {
      write(ref, leaf.value, label);
      continue;
    }

    // "general": "prose" — the key names a whole section, not a field.
    const sink = sectionCatchAll.get(normalizeKey(leaf.key));
    if (sink) {
      write(sink, leaf.value, label);
      continue;
    }

    // Nested under a known section but with an unknown field name.
    const parentSink = parentKey ? sectionCatchAll.get(normalizeKey(parentKey)) : undefined;
    if (parentSink) {
      write(parentSink, `${humanizeKey(leaf.key)}: ${asText(leaf.value)}`, label);
      continue;
    }

    unmapped.push({ label, value: asText(leaf.value) });
  }

  return { sections: working, unmapped };
};

// ─── Normalisation of raw AI payloads ──────────────────────────────────────

const toStringOrNull = (value: unknown): string | null => {
  if (isBlank(value)) return null;
  const text = asText(value);
  return text || null;
};

const normalizeSeverity = (value: unknown): 'mild' | 'moderate' | 'severe' | null => {
  const text = asText(value).toLowerCase();
  return text === 'mild' || text === 'moderate' || text === 'severe' ? text : null;
};

const normalizeSymptom = (raw: unknown): ExtractedSymptom | null => {
  if (isBlank(raw)) return null;
  if (typeof raw === 'string') return { name: raw.trim() };
  const item = raw as Record<string, unknown>;
  const name = toStringOrNull(item.name ?? item.symptom ?? item.complaint);
  if (!name) return null;
  return {
    name,
    severity: normalizeSeverity(item.severity),
    duration: toStringOrNull(item.duration),
    location: toStringOrNull(item.location ?? item.site),
    pattern: toStringOrNull(item.pattern),
    character: toStringOrNull(item.character ?? item.quality),
    associatedSymptoms: Array.isArray(item.associatedSymptoms)
      ? (item.associatedSymptoms as unknown[]).map(asText).filter(Boolean)
      : toStringOrNull(item.associatedSymptoms),
    aggravatingFactors: toStringOrNull(item.aggravatingFactors),
    relievingFactors: toStringOrNull(item.relievingFactors),
    notes: toStringOrNull(item.notes),
  };
};

const normalizeDiagnosis = (raw: unknown): ExtractedDiagnosis | null => {
  if (isBlank(raw)) return null;
  if (typeof raw === 'string') return { name: raw.trim(), isPrimary: false };
  const item = raw as Record<string, unknown>;
  const name = toStringOrNull(item.name ?? item.diagnosis);
  if (!name) return null;
  return {
    name,
    icd10Code: toStringOrNull(item.icd10Code ?? item.icd10 ?? item.icdCode),
    isPrimary: Boolean(item.isPrimary),
    notes: toStringOrNull(item.notes),
  };
};

const normalizePrescription = (raw: unknown): ExtractedPrescription | null => {
  if (isBlank(raw)) return null;
  if (typeof raw === 'string') return { medicine: raw.trim() };
  const item = raw as Record<string, unknown>;
  const medicine = toStringOrNull(item.medicine ?? item.drug ?? item.name);
  if (!medicine) return null;
  return {
    medicine,
    dosage: toStringOrNull(item.dosage ?? item.dose),
    frequency: toStringOrNull(item.frequency),
    duration: toStringOrNull(item.duration),
    instructions: toStringOrNull(item.instructions),
    route: toStringOrNull(item.route),
    quantity: typeof item.quantity === 'number' ? item.quantity : null,
    refills: typeof item.refills === 'number' ? item.refills : null,
  };
};

const normalizeTest = (raw: unknown): ExtractedTest | null => {
  if (isBlank(raw)) return null;
  if (typeof raw === 'string') return { testName: raw.trim() };
  const item = raw as Record<string, unknown>;
  const testName = toStringOrNull(item.testName ?? item.name ?? item.test);
  if (!testName) return null;
  return {
    testName,
    testType: toStringOrNull(item.testType ?? item.type),
    urgency: toStringOrNull(item.urgency),
    instructions: toStringOrNull(item.instructions),
  };
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : isBlank(value) ? [] : [value]);

/**
 * Accepts the raw JSON from any of the AI endpoints — voice transcription
 * (`extractedFields`), image analysis (`structuredData`) or case-paper NLP
 * (flat) — and returns one canonical extraction.
 */
export const normalizeExtraction = (raw: unknown): EmrExtraction => {
  const root = (raw ?? {}) as Record<string, unknown>;
  const nested = (root.extractedFields ?? root.structuredData ?? root.extractedData ?? {}) as Record<string, unknown>;
  const pick = <T>(key: string): T | undefined =>
    (nested[key] !== undefined ? nested[key] : root[key]) as T | undefined;

  const vitalsRaw = (pick<Record<string, unknown>>('vitals') ?? {}) as Record<string, unknown>;

  return {
    chiefComplaint: toStringOrNull(pick('chiefComplaint')),
    symptoms: asArray(pick('symptoms')).map(normalizeSymptom).filter((s): s is ExtractedSymptom => Boolean(s)),
    vitals: {
      temperature: toStringOrNull(vitalsRaw.temperature),
      bloodPressure: toStringOrNull(vitalsRaw.bloodPressure ?? vitalsRaw.bp),
      pulse: toStringOrNull(vitalsRaw.pulse ?? vitalsRaw.heartRate),
      weight: toStringOrNull(vitalsRaw.weight),
      height: toStringOrNull(vitalsRaw.height),
      respiratoryRate: toStringOrNull(vitalsRaw.respiratoryRate ?? vitalsRaw.rr),
      oxygenSaturation: toStringOrNull(vitalsRaw.oxygenSaturation ?? vitalsRaw.spo2),
    },
    examination: (pick<Record<string, unknown>>('examination') ??
      pick<Record<string, unknown>>('physicalExamination') ??
      null) as Record<string, unknown> | null,
    diagnoses: asArray(pick('diagnoses')).map(normalizeDiagnosis).filter((d): d is ExtractedDiagnosis => Boolean(d)),
    suggestedDiagnoses: asArray(pick('suggestedDiagnoses'))
      .map((item): EmrExtraction['suggestedDiagnoses'][number] | null => {
        if (isBlank(item)) return null;
        if (typeof item === 'string') return { name: item.trim() };
        const record = item as Record<string, unknown>;
        const name = toStringOrNull(record.name);
        return name ? { name, likelihood: toStringOrNull(record.likelihood), reasoning: toStringOrNull(record.reasoning) } : null;
      })
      .filter((d): d is EmrExtraction['suggestedDiagnoses'][number] => Boolean(d)),
    prescriptions: asArray(pick('prescriptions')).map(normalizePrescription).filter((p): p is ExtractedPrescription => Boolean(p)),
    testsOrdered: asArray(pick('testsOrdered') ?? pick('tests')).map(normalizeTest).filter((t): t is ExtractedTest => Boolean(t)),
    advice: asArray(pick('advice')).map(asText).filter(Boolean),
    followUp: (pick<Record<string, unknown>>('followUp') ?? null) as EmrExtraction['followUp'],
    doctorNotes: toStringOrNull(pick('doctorNotes')),
    unmappedFindings: asArray(pick('unmappedFindings'))
      .map((item): UnmappedFinding | null => {
        if (isBlank(item)) return null;
        if (typeof item === 'string') return { label: 'Additional finding', value: item.trim() };
        const record = item as Record<string, unknown>;
        const value = toStringOrNull(record.value ?? record.finding ?? record.detail);
        return value ? { label: toStringOrNull(record.label) || 'Additional finding', value } : null;
      })
      .filter((f): f is UnmappedFinding => Boolean(f)),
    transcript: toStringOrNull(root.transcript),
  };
};

// ─── Merge into the visit form ─────────────────────────────────────────────

/**
 * Structural view of the visit form state that the merge needs. Deliberately
 * loose on list element types so the caller's richer domain types (Symptom,
 * Prescription, TestOrdered…) satisfy it without an index-signature clash.
 */
export interface EmrFormDataLike {
  chiefComplaint: string;
  symptoms: any[];
  vitals: {
    temperature: string;
    bloodPressure: string;
    pulse: string;
    weight: string;
    height: string;
    respiratoryRate: string;
    oxygenSaturation: string;
  };
  diagnoses: any[];
  prescriptions: any[];
  testsOrdered: any[];
  advice: string[];
  followUpDate: string;
  doctorNotes: string;
}

export interface MergeSummary {
  chiefComplaint: boolean;
  symptoms: number;
  vitals: number;
  examinationFields: number;
  diagnoses: number;
  prescriptions: number;
  testsOrdered: number;
  advice: number;
  followUpDate: boolean;
  notesAppended: number;
  skippedDuplicates: number;
}

const emptySummary = (): MergeSummary => ({
  chiefComplaint: false,
  symptoms: 0,
  vitals: 0,
  examinationFields: 0,
  diagnoses: 0,
  prescriptions: 0,
  testsOrdered: 0,
  advice: 0,
  followUpDate: false,
  notesAppended: 0,
  skippedDuplicates: 0,
});

const buildSymptomNotes = (symptom: ExtractedSymptom): string | undefined => {
  const parts: string[] = [];
  if (symptom.location) parts.push(`Location: ${symptom.location}`);
  if (symptom.pattern) parts.push(`Pattern: ${symptom.pattern}`);
  if (symptom.character) parts.push(`Character: ${symptom.character}`);
  const associated = Array.isArray(symptom.associatedSymptoms)
    ? symptom.associatedSymptoms.join(', ')
    : symptom.associatedSymptoms;
  if (associated) parts.push(`Associated: ${associated}`);
  if (symptom.aggravatingFactors) parts.push(`Worse with: ${symptom.aggravatingFactors}`);
  if (symptom.relievingFactors) parts.push(`Better with: ${symptom.relievingFactors}`);
  if (symptom.notes) parts.push(symptom.notes);
  return parts.length ? parts.join('; ') : undefined;
};

const TEST_TYPES = ['lab', 'radiology', 'procedure', 'other'];
const mapTestType = (value?: string | null): 'lab' | 'radiology' | 'procedure' | 'other' => {
  const text = (value || '').toLowerCase();
  if (text === 'imaging' || text === 'radiology' || text === 'xray' || text === 'x-ray') return 'radiology';
  return (TEST_TYPES.includes(text) ? text : 'lab') as 'lab' | 'radiology' | 'procedure' | 'other';
};

const mapUrgency = (value?: string | null): 'routine' | 'urgent' | 'stat' => {
  const text = (value || '').toLowerCase();
  return text === 'urgent' || text === 'stat' ? text : 'routine';
};

export const parseFollowUpDate = (duration?: string | null, from: Date = new Date()): string | null => {
  if (!duration) return null;
  const isoMatch = duration.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const match = duration.match(/(\d+)\s*(day|week|month|year)/i);
  if (!match) return null;
  const [, amount, unit] = match;
  const target = new Date(from.getTime());
  const n = parseInt(amount, 10);
  switch (unit.toLowerCase()) {
    case 'day': target.setDate(target.getDate() + n); break;
    case 'week': target.setDate(target.getDate() + n * 7); break;
    case 'month': target.setMonth(target.getMonth() + n); break;
    case 'year': target.setFullYear(target.getFullYear() + n); break;
  }
  return target.toISOString().split('T')[0];
};

/**
 * Merge a normalised extraction into the visit form + examination state.
 *
 * Guarantees: no clinically relevant value is discarded. Anything that has no
 * structured home lands in doctor notes, and the returned summary says exactly
 * what went where so the doctor can verify.
 */
export const mergeExtractionIntoForm = <T extends EmrFormDataLike>(
  formData: T,
  extraction: EmrExtraction,
  examination: PhysicalExamination | undefined,
  options: { sourceLabel?: string; now?: Date } = {}
): { formData: T; examination: PhysicalExamination | undefined; summary: MergeSummary } => {
  const sourceLabel = options.sourceLabel || 'AI';
  const now = options.now || new Date();
  const summary = emptySummary();
  const next: EmrFormDataLike = {
    ...formData,
    symptoms: [...formData.symptoms],
    vitals: { ...formData.vitals },
    diagnoses: [...formData.diagnoses],
    prescriptions: [...formData.prescriptions],
    testsOrdered: [...formData.testsOrdered],
    advice: [...formData.advice],
  };
  const notes: string[] = [];

  // Chief complaint — never clobber what the doctor typed.
  if (extraction.chiefComplaint) {
    if (!next.chiefComplaint?.trim()) {
      next.chiefComplaint = extraction.chiefComplaint;
      summary.chiefComplaint = true;
    } else if (normalizeKey(next.chiefComplaint) !== normalizeKey(extraction.chiefComplaint)) {
      notes.push(`Chief complaint heard: ${extraction.chiefComplaint}`);
    }
  }

  // Symptoms
  const existingSymptoms = new Set(next.symptoms.map(s => normalizeKey(s.name || '')));
  for (const symptom of extraction.symptoms) {
    const key = normalizeKey(symptom.name);
    if (!key) continue;
    if (existingSymptoms.has(key)) { summary.skippedDuplicates++; continue; }
    existingSymptoms.add(key);
    next.symptoms.push({
      name: symptom.name,
      severity: symptom.severity || undefined,
      duration: symptom.duration || undefined,
      notes: buildSymptomNotes(symptom),
    });
    summary.symptoms++;
  }

  // Vitals — fill blanks only.
  (Object.keys(extraction.vitals) as Array<keyof EmrExtraction['vitals']>).forEach(key => {
    const value = extraction.vitals[key];
    if (!value) return;
    const current = (next.vitals as Record<string, string | undefined>)[key];
    if (current && current.trim()) return;
    (next.vitals as Record<string, string>)[key] = value;
    summary.vitals++;
  });

  // Diagnoses
  const existingDiagnoses = new Set(next.diagnoses.map(d => normalizeKey(d.name || '')));
  for (const diagnosis of extraction.diagnoses) {
    const key = normalizeKey(diagnosis.name);
    if (!key) continue;
    if (existingDiagnoses.has(key)) { summary.skippedDuplicates++; continue; }
    existingDiagnoses.add(key);
    next.diagnoses.push({
      name: diagnosis.name,
      icd10Code: diagnosis.icd10Code || undefined,
      isPrimary: diagnosis.isPrimary || false,
      notes: diagnosis.notes || undefined,
    });
    summary.diagnoses++;
  }

  // Prescriptions
  const existingRx = new Set(next.prescriptions.map(p => normalizeKey(String(p.medicine || ''))));
  extraction.prescriptions.forEach((rx, index) => {
    const key = normalizeKey(rx.medicine);
    if (!key) return;
    if (existingRx.has(key)) { summary.skippedDuplicates++; return; }
    existingRx.add(key);
    next.prescriptions.push({
      id: `ai_rx_${now.getTime()}_${index}`,
      visitId: '',
      medicine: rx.medicine,
      dosage: rx.dosage || '',
      frequency: rx.frequency || '',
      duration: rx.duration || '',
      instructions: rx.instructions || '',
      quantity: rx.quantity ?? undefined,
      refills: rx.refills ?? undefined,
      route: rx.route ?? undefined,
      createdAt: now,
    });
    summary.prescriptions++;
  });

  // Tests ordered
  const existingTests = new Set(next.testsOrdered.map(t => normalizeKey(String(t.testName || ''))));
  for (const test of extraction.testsOrdered) {
    const key = normalizeKey(test.testName);
    if (!key) continue;
    if (existingTests.has(key)) { summary.skippedDuplicates++; continue; }
    existingTests.add(key);
    next.testsOrdered.push({
      testName: test.testName,
      testType: mapTestType(test.testType),
      instructions: test.instructions || undefined,
      urgency: mapUrgency(test.urgency),
      status: 'ordered',
      orderedDate: now,
    });
    summary.testsOrdered++;
  }

  // Advice
  const existingAdvice = new Set(next.advice.map(a => normalizeKey(a)));
  const pushAdvice = (text: string) => {
    const key = normalizeKey(text);
    if (!key || existingAdvice.has(key)) return;
    existingAdvice.add(key);
    next.advice.push(text);
    summary.advice++;
  };
  extraction.advice.forEach(pushAdvice);

  // Follow-up
  if (extraction.followUp) {
    const parsed = parseFollowUpDate(extraction.followUp.duration, now);
    if (parsed && !next.followUpDate) {
      next.followUpDate = parsed;
      summary.followUpDate = true;
    } else if (extraction.followUp.duration && !parsed) {
      pushAdvice(`Follow-up: ${extraction.followUp.duration}`);
    }
    if (extraction.followUp.instructions) pushAdvice(`Follow-up: ${extraction.followUp.instructions}`);
    (extraction.followUp.warningSignsToWatch || []).filter(Boolean).forEach(sign => {
      pushAdvice(`Report immediately if: ${sign}`);
    });
  }

  // Examination — always against a real schema, template or default.
  let nextExamination = examination;
  const hasExaminationData =
    extraction.examination && Object.keys(extraction.examination as Record<string, unknown>).length > 0;

  if (hasExaminationData) {
    const base = examination?.sections?.length ? examination : createDefaultExamination();
    const { sections, unmapped } = applyExaminationFindings(base.sections, extraction.examination!);
    const filledBefore = base.sections.reduce(
      (count, section) => count + section.fields.filter(f => f.value !== '' && f.value !== false).length,
      0
    );
    const filledAfter = sections.reduce(
      (count, section) => count + section.fields.filter(f => f.value !== '' && f.value !== false).length,
      0
    );
    summary.examinationFields = Math.max(0, filledAfter - filledBefore);
    nextExamination = { ...base, sections };
    unmapped.forEach(item => notes.push(`${item.label}: ${item.value}`));
  }

  // Everything the AI could not place, plus its own free-text notes.
  extraction.unmappedFindings.forEach(item => notes.push(`${item.label}: ${item.value}`));
  if (extraction.doctorNotes) notes.push(extraction.doctorNotes);

  if (extraction.suggestedDiagnoses.length) {
    const differentials = extraction.suggestedDiagnoses
      .map(d => [d.name, d.likelihood ? `(${d.likelihood})` : null, d.reasoning ? `— ${d.reasoning}` : null].filter(Boolean).join(' '))
      .join('; ');
    notes.push(`AI differentials (review before adding): ${differentials}`);
  }

  if (notes.length) {
    const block = `[${sourceLabel}]\n${notes.map(line => `• ${line}`).join('\n')}`;
    next.doctorNotes = next.doctorNotes?.trim() ? `${next.doctorNotes.trim()}\n\n${block}` : block;
    summary.notesAppended = notes.length;
  }

  return { formData: next as T, examination: nextExamination, summary };
};

export const summarizeMerge = (summary: MergeSummary): string => {
  const parts: string[] = [];
  if (summary.chiefComplaint) parts.push('chief complaint');
  if (summary.symptoms) parts.push(`${summary.symptoms} symptom(s)`);
  if (summary.vitals) parts.push(`${summary.vitals} vital(s)`);
  if (summary.examinationFields) parts.push(`${summary.examinationFields} examination field(s)`);
  if (summary.diagnoses) parts.push(`${summary.diagnoses} diagnosis(es)`);
  if (summary.prescriptions) parts.push(`${summary.prescriptions} prescription(s)`);
  if (summary.testsOrdered) parts.push(`${summary.testsOrdered} test(s)`);
  if (summary.advice) parts.push(`${summary.advice} advice line(s)`);
  if (summary.followUpDate) parts.push('follow-up date');

  const head = parts.length ? `Applied: ${parts.join(', ')}.` : 'Nothing new to apply — the form already has this information.';
  const tail: string[] = [];
  if (summary.notesAppended) tail.push(`${summary.notesAppended} extra finding(s) added to Doctor Notes.`);
  if (summary.skippedDuplicates) tail.push(`${summary.skippedDuplicates} duplicate(s) skipped.`);
  return [head, ...tail].join(' ');
};
