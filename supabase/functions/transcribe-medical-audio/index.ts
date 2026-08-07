import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
    resolveExaminationSchema,
    describeExaminationSchema,
    EXAMINATION_MAPPING_RULES
} from "../_shared/examinationSchema.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Privacy filter function - removes very sensitive content
function filterSensitiveContent(text: string): { filtered: string; redactionCount: number } {
    let filtered = text;
    let redactionCount = 0;

    // Patterns for very sensitive content only (as per user request)
    const sensitivePatterns = [
        // Sexual health details (not clinical terminology)
        /\b(sexual intercourse|coitus|orgasm|masturbat\w+|erotic|pornograph\w+)\b/gi,
        // Explicit financial data
        /\b(bank account|credit card|debit card|account number|PIN|password)\b[:\s]*[\d\-]+/gi,
        // Phone numbers (non-clinical)
        /(?<!\bphone:?\s?)(?<!\bemergency:?\s?)\b\d{10,}\b/g,
        // Email addresses (non-clinical)
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        // Aadhaar numbers (Indian ID)
        /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    ];

    sensitivePatterns.forEach(pattern => {
        const matches = filtered.match(pattern);
        if (matches) {
            redactionCount += matches.length;
            filtered = filtered.replace(pattern, '[REDACTED]');
        }
    });

    return { filtered, redactionCount };
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { audioBase64, mimeType, visitContext, transcriptText } = await req.json();

        if (!audioBase64 && !transcriptText) {
            return new Response(JSON.stringify({
                error: 'audioBase64 or transcriptText is required'
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const apiKey = Deno.env.get('ALLGOOGLE_KEY');
        if (!apiKey) {
            return new Response(JSON.stringify({
                error: 'Google API key not configured'
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // `examinationSchema` is the schema built by the client; `examinationTemplate`
        // is the legacy full PhysicalExamination payload. Either yields section/field
        // keys; neither present falls back to the standard OPD schema.
        const examSchema = resolveExaminationSchema(
            visitContext?.examinationSchema ?? visitContext?.examinationTemplate
        );
        const hasExamTemplate = examSchema.isTemplate;
        const examSchemaText = describeExaminationSchema(examSchema);

        const systemPrompt = `You are an expert medical transcription AI specialized in doctor-patient consultations in Indian OPD (Outpatient Department) settings.

YOUR TASK:
1. ${transcriptText ? 'Re-read the supplied transcript' : 'Transcribe the audio accurately, preserving medical terminology'}
2. Extract ALL clinically relevant information comprehensively
3. Map every extracted item onto the EMR target fields listed below
4. Suggest probable diagnoses based on symptoms discussed
5. Filter only very sensitive non-clinical info (financial, personal IDs)

🚨 THE GOLDEN RULE — NOTHING MAY BE LOST:
Every clinically relevant statement in the consultation must appear somewhere in
your JSON output. If a finding does not fit any structured field below, you MUST
put it in "unmappedFindings" (with a short label) or in "doctorNotes". Silently
dropping information is a serious error. Never invent information either.

EXISTING VISIT CONTEXT (already in the EMR — extract it again only if the doctor restates or changes it):
- Chief Complaint Entered: ${visitContext?.chiefComplaint || 'Not entered yet'}
- Symptoms Already Added: ${visitContext?.currentSymptoms?.join(', ') || 'None added yet'}
- Diagnoses Already Added: ${visitContext?.currentDiagnoses?.join(', ') || 'None added yet'}
- Patient: ${visitContext?.patientAge ? `${visitContext.patientAge} years` : 'age unknown'}, ${visitContext?.patientGender || 'gender unknown'}
- Doctor Specialization: ${visitContext?.doctorSpecialization || 'General Medicine'}

EXAMINATION TARGET FIELDS ${hasExamTemplate
                ? `(the doctor has LOADED THEIR OWN TEMPLATE${examSchema.templateName ? `: "${examSchema.templateName}"` : ''} — these exact keys must be used)`
                : '(no template loaded — use this standard OPD schema)'}:
${examSchemaText}

${EXAMINATION_MAPPING_RULES}

EXTRACTION GUIDELINES:

**CHIEF COMPLAINT**: The main reason for visit — a brief 2-5 word summary.

**SYMPTOMS**: Extract with FULL DETAILS:
- name, location, duration, severity (mild/moderate/severe, inferred: "little pain"=mild, "can't bear"=severe),
  pattern (when it occurs), character (sharp/dull/burning/cramping), associatedSymptoms,
  aggravatingFactors, relievingFactors

**VITALS**: temperature, bloodPressure, pulse, weight, height, oxygenSaturation, respiratoryRate.
Return them as plain strings with their units as spoken (e.g. "98.6 F", "120/80", "72", "98%").

**DIAGNOSES**: Any diagnosis the doctor mentions or confirms, even tentatively. Include ICD-10 where known.

**DIFFERENTIAL DIAGNOSES**: AI-suggested possibilities, ranked by likelihood. These go in
"suggestedDiagnoses" only — never in "diagnoses".

**PRESCRIPTIONS**: medicine, dosage, frequency (BD/TDS/OD…), duration, instructions, route.

**TESTS ORDERED**: testName, testType (lab/imaging/procedure), urgency (routine/urgent), instructions.
Investigations mentioned for ordering belong here — NOT in advice.

**ADVICE**: Lifestyle advice, precautions, diet, do's and don'ts.

**FOLLOW UP**: When to return, instructions, warning signs that should bring the patient back sooner.

**DOCTOR NOTES**: Clinically relevant discussion that belongs in the record but fits no field above —
past history, allergies, drug reactions, surgical history, family history, occupation-related factors,
patient counselling, referral, red flags, prognosis discussion.

OUTPUT JSON FORMAT (return ONLY this JSON, no other text):
{
  "transcript": "Full cleaned transcription of the conversation",
  "chiefComplaint": "Brief 2-5 word chief complaint if extractable, else null",
  "extractedFields": {
    "symptoms": [
      {
        "name": "string",
        "location": "string or null",
        "duration": "string or null",
        "severity": "mild|moderate|severe or null",
        "pattern": "string or null",
        "character": "string or null",
        "associatedSymptoms": ["array"] or null,
        "aggravatingFactors": "string or null",
        "relievingFactors": "string or null"
      }
    ],
    "vitals": {
      "temperature": "string or null",
      "bloodPressure": "string or null",
      "pulse": "string or null",
      "weight": "string or null",
      "height": "string or null",
      "oxygenSaturation": "string or null",
      "respiratoryRate": "string or null"
    },
    "examination": {
      "<sectionId>": { "<fieldKey>": "value" }
    },
    "diagnoses": [
      { "name": "string", "icd10Code": "string or null", "isPrimary": true, "notes": "string or null" }
    ],
    "prescriptions": [
      {
        "medicine": "string",
        "dosage": "string or null",
        "frequency": "string or null",
        "duration": "string or null",
        "instructions": "string or null",
        "route": "oral|topical|injection|other or null"
      }
    ],
    "testsOrdered": [
      { "testName": "string", "testType": "lab|imaging|procedure", "urgency": "routine|urgent", "instructions": "string or null" }
    ],
    "advice": ["array of advice strings"],
    "followUp": {
      "duration": "string or null",
      "instructions": "string or null",
      "warningSignsToWatch": ["array"] or null
    },
    "doctorNotes": "Other clinically relevant content, or null",
    "unmappedFindings": [
      { "label": "short label", "value": "the finding that fit no field above" }
    ]
  },
  "suggestedDiagnoses": [
    { "name": "string", "likelihood": "high|medium|low", "reasoning": "brief explanation" }
  ],
  "privacyRedactions": 0,
  "confidence": { "transcription": 0.0, "extraction": 0.0 }
}

IMPORTANT RULES:
1. Extract EVERYTHING mentioned, even casually.
2. "right side pain for 2 days, constant" → location="right side", duration="2 days", pattern="constant".
3. Infer severity from context.
4. If the doctor mentions a diagnosis even tentatively, extract it into "diagnoses".
5. ${hasExamTemplate
                ? 'CRITICAL: the examination keys above come from the doctor\'s own template — match them exactly.'
                : 'No template is loaded, so use the standard schema keys above exactly.'}
6. Return ONLY valid JSON, no markdown fences, no explanation.
7. Use null for fields not mentioned; do not omit keys from the top-level structure.
8. Re-check before answering: is every clinical statement represented somewhere? If not, add it to
   "unmappedFindings" or "doctorNotes".`;

        const parts: unknown[] = [{ text: systemPrompt }];
        if (transcriptText) {
            parts.push({ text: `\n\nTRANSCRIPT TO RE-MAP (already transcribed — reproduce it verbatim in "transcript"):\n${transcriptText}` });
        } else {
            parts.push({
                inline_data: {
                    mime_type: mimeType || 'audio/webm',
                    data: audioBase64
                }
            });
        }

        // Call Gemini with audio (or the supplied transcript)
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: {
                    temperature: 0.2,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 8192,
                    responseMimeType: 'application/json'
                }
            })
        });

        const geminiData = await geminiResponse.json();

        if (geminiData.error) {
            throw new Error(`Gemini API error: ${geminiData.error.message}`);
        }

        const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!generatedText) {
            throw new Error('No response generated from Gemini');
        }

        // Parse the response
        let result;
        try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No valid JSON found in response');
            }
        } catch (_parseError) {
            // Never lose the content: keep the raw model output as the transcript
            // and hand it to the form as an unmapped finding.
            result = {
                transcript: transcriptText || generatedText,
                extractedFields: {
                    symptoms: [],
                    vitals: {},
                    examination: {},
                    diagnoses: [],
                    prescriptions: [],
                    testsOrdered: [],
                    advice: [],
                    followUp: null,
                    doctorNotes: generatedText,
                    unmappedFindings: []
                },
                suggestedDiagnoses: [],
                privacyRedactions: 0,
                parseError: true
            };
        }

        // Ensure the structured envelope is always complete for the client mapper
        result.extractedFields = result.extractedFields || {};
        const fields = result.extractedFields;
        fields.symptoms = fields.symptoms || [];
        fields.vitals = fields.vitals || {};
        fields.examination = fields.examination || {};
        fields.diagnoses = fields.diagnoses || [];
        fields.prescriptions = fields.prescriptions || [];
        fields.testsOrdered = fields.testsOrdered || [];
        fields.advice = fields.advice || [];
        fields.unmappedFindings = fields.unmappedFindings || [];
        fields.chiefComplaint = fields.chiefComplaint ?? result.chiefComplaint ?? null;
        result.suggestedDiagnoses = result.suggestedDiagnoses || [];
        // Mirror onto extractedFields so a client that only forwards that object
        // still receives the differentials.
        fields.suggestedDiagnoses = result.suggestedDiagnoses;

        if (transcriptText && !result.transcript) {
            result.transcript = transcriptText;
        }

        // Apply additional privacy filtering to transcript
        if (result.transcript) {
            const { filtered, redactionCount } = filterSensitiveContent(result.transcript);
            result.transcript = filtered;
            result.privacyRedactions = (result.privacyRedactions || 0) + redactionCount;
        }

        return new Response(JSON.stringify({
            success: true,
            examinationSchemaUsed: {
                isTemplate: examSchema.isTemplate,
                templateName: examSchema.templateName,
                sectionCount: examSchema.sections.length
            },
            ...result
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({
            error: 'Failed to transcribe audio',
            details: errorMessage
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
