/**
 * Examination target schema shared by every AI extraction function
 * (transcribe-medical-audio, gemini-nlp, gemini-analyze-image).
 *
 * Mirrors DEFAULT_EXAMINATION_SECTIONS in src/utils/emrMapping.ts — keep the
 * two in sync. The client maps AI output back onto these keys, so a mismatch
 * means findings silently land in Doctor Notes instead of their fields.
 */

export interface SchemaField {
    key: string;
    label: string;
    type: 'text' | 'select' | 'toggle' | 'textarea';
    options?: string[];
}

export interface SchemaSection {
    id: string;
    title: string;
    fields: SchemaField[];
}

export interface ResolvedSchema {
    isTemplate: boolean;
    templateName: string | null;
    sections: SchemaSection[];
}

export const DEFAULT_EXAMINATION_SECTIONS: SchemaSection[] = [
    {
        id: 'general',
        title: 'General Examination',
        fields: [
            { key: 'generalCondition', label: 'General Condition', type: 'text' },
            { key: 'pallor', label: 'Pallor', type: 'select', options: ['Absent', 'Present', 'Not examined'] },
            { key: 'icterus', label: 'Icterus', type: 'select', options: ['Absent', 'Present', 'Not examined'] },
            { key: 'cyanosis', label: 'Cyanosis', type: 'select', options: ['Absent', 'Present', 'Not examined'] },
            { key: 'clubbing', label: 'Clubbing', type: 'select', options: ['Absent', 'Present', 'Not examined'] },
            { key: 'lymphadenopathy', label: 'Lymphadenopathy', type: 'select', options: ['Absent', 'Present', 'Not examined'] },
            { key: 'edema', label: 'Oedema', type: 'select', options: ['Absent', 'Present', 'Not examined'] },
            { key: 'generalNotes', label: 'Other General Findings', type: 'textarea' }
        ]
    },
    {
        id: 'cardiovascular',
        title: 'Cardiovascular System (CVS)',
        fields: [
            { key: 'heartSounds', label: 'Heart Sounds', type: 'text' },
            { key: 'murmurs', label: 'Murmurs', type: 'text' },
            { key: 'cvsNotes', label: 'Other CVS Findings', type: 'textarea' }
        ]
    },
    {
        id: 'respiratory',
        title: 'Respiratory System (RS)',
        fields: [
            { key: 'breathSounds', label: 'Breath Sounds', type: 'text' },
            { key: 'addedSounds', label: 'Added Sounds (crepitations / wheeze)', type: 'text' },
            { key: 'respiratoryNotes', label: 'Other Respiratory Findings', type: 'textarea' }
        ]
    },
    {
        id: 'abdomen',
        title: 'Per Abdomen (P/A)',
        fields: [
            { key: 'tenderness', label: 'Tenderness', type: 'text' },
            { key: 'organomegaly', label: 'Organomegaly', type: 'text' },
            { key: 'bowelSounds', label: 'Bowel Sounds', type: 'text' },
            { key: 'abdomenNotes', label: 'Other Abdominal Findings', type: 'textarea' }
        ]
    },
    {
        id: 'neurological',
        title: 'Central Nervous System (CNS)',
        fields: [
            { key: 'consciousness', label: 'Higher Functions / Consciousness', type: 'text' },
            { key: 'motor', label: 'Motor System', type: 'text' },
            { key: 'sensory', label: 'Sensory System', type: 'text' },
            { key: 'reflexes', label: 'Reflexes', type: 'text' },
            { key: 'neurologicalNotes', label: 'Other Neurological Findings', type: 'textarea' }
        ]
    },
    {
        id: 'localExamination',
        title: 'Local Examination',
        fields: [
            { key: 'inspection', label: 'Inspection', type: 'textarea' },
            { key: 'palpation', label: 'Palpation', type: 'textarea' },
            { key: 'localNotes', label: 'Other Local Findings', type: 'textarea' }
        ]
    },
    {
        id: 'other',
        title: 'Other Findings',
        fields: [
            { key: 'otherFindings', label: 'Other Systemic Findings', type: 'textarea' }
        ]
    }
];

/**
 * Normalise whatever the client sent into a usable schema.
 * Accepts the `examinationSchema` payload built by buildExaminationSchemaForAI,
 * or a legacy full PhysicalExamination object (with values), or nothing —
 * in which case the standard OPD schema is used so the AI always has targets.
 */
export function resolveExaminationSchema(input: unknown): ResolvedSchema {
    const candidate = input as {
        sections?: Array<{ id: string; title: string; fields?: SchemaField[] }>;
        isTemplate?: boolean;
        templateName?: string;
    } | null | undefined;

    if (candidate?.sections?.length) {
        return {
            isTemplate: candidate.isTemplate !== false,
            templateName: candidate.templateName || null,
            sections: candidate.sections.map(section => ({
                id: section.id,
                title: section.title,
                fields: (section.fields || []).map(field => ({
                    key: field.key,
                    label: field.label,
                    type: field.type,
                    ...(field.options?.length ? { options: field.options } : {})
                }))
            }))
        };
    }

    return { isTemplate: false, templateName: null, sections: DEFAULT_EXAMINATION_SECTIONS };
}

/** Render the schema as prompt text, spelling out types and allowed values. */
export function describeExaminationSchema(schema: ResolvedSchema): string {
    return schema.sections
        .map(section => {
            const fields = section.fields
                .map(field => {
                    const options = field.options?.length
                        ? ` — allowed values ONLY: ${field.options.map(o => `"${o}"`).join(' | ')}`
                        : '';
                    const typeHint =
                        field.type === 'toggle'
                            ? ' (boolean true/false)'
                            : field.type === 'select'
                                ? ' (pick one allowed value)'
                                : ' (free text)';
                    return `    - "${field.key}" = ${field.label}${typeHint}${options}`;
                })
                .join('\n');
            return `  Section "${section.id}" (${section.title}):\n${fields}`;
        })
        .join('\n');
}

/** The mapping rules block, identical across extraction prompts. */
export const EXAMINATION_MAPPING_RULES = `EXAMINATION MAPPING RULES:
- Output "examination" as an object keyed by SECTION id, each holding that section's FIELD keys.
  Example: { "general": { "pallor": "Present" }, "abdomen": { "tenderness": "RIF tenderness" } }
- Use the EXACT section ids and field keys shown above. Do not rename, translate or pluralise them.
- For "(boolean true/false)" fields output real JSON true/false, never the words "present"/"absent".
- For "(pick one allowed value)" fields output one listed value VERBATIM. If nothing matches, omit the
  field and record the finding in "unmappedFindings".
- A finding belonging to a section but matching no field goes in that section's free-text/notes field.
- A finding fitting no section at all goes in "unmappedFindings".
- Omit fields that were not assessed. Never fill a field with "normal" unless that was actually stated.`;
