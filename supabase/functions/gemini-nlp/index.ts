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

// Vitals arrive as strings ("98.6 F", "120/80") or numbers depending on the
// model's mood. Keep them as trimmed strings — the form fields are text inputs
// and visitService parses them at save time.
const asVital = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['n/a', 'na', 'null', 'not mentioned', 'not recorded', '-', 'nil'].includes(lower)) return null;
  return text;
};

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value);
  const trimmed = text.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { rawText, cleanedMedicalText, ocrUploadId, examinationSchema, visitContext } = await req.json();
    const textInput = rawText || cleanedMedicalText;

    if (!textInput || textInput.trim() === '') {
      return new Response(JSON.stringify({
        error: 'Either rawText or cleanedMedicalText is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const apiKey = Deno.env.get('ALLGOOGLE_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'Google API key not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const examSchema = resolveExaminationSchema(examinationSchema);
    const examSchemaText = describeExaminationSchema(examSchema);

    const prompt = `You are a highly accurate medical data extraction AI specialized in Indian clinical case papers. Your task is to extract clinically relevant data from raw OCR-scanned text written by Indian doctors and return it as a structured JSON object using the exact schema provided below.

🌟 OBJECTIVE:
Parse the input text carefully, identify clinical information, and represent it in the structured schema. Pay close attention to format, terminology, and correctness. Normalize where applicable, but never fabricate missing data.

🚨 THE GOLDEN RULE — NOTHING MAY BE LOST:
Every clinically relevant item written on the case paper must appear somewhere in your JSON.
If something fits no structured field, put it in "unmappedFindings" or "doctorNotes".
Dropping content is a serious error. Inventing content is equally serious.

❌ COMMON MISTAKES TO AVOID:
- Do NOT skip symptoms like "Hair fall" or "Diffuse thinning" if mentioned.
- Do NOT mislabel external-use items (e.g. shampoo, serum) as "tablet."
- Do NOT assign arbitrary durations if they are not present in the source.
- Do NOT leave ICD-10 codes empty if a known diagnosis clearly maps (e.g., MPB → "L64.0").
- Do NOT include clinic branding, addresses, doctor names, or administrative content.
- Do NOT put investigations into "advice" — they belong in "testsOrdered".

✅ WHAT TO INCLUDE:
- Symptoms and complaints exactly as mentioned, with severity/duration/location when written.
- Diagnoses with clinical notes (e.g., "Grade-III"), and ICD-10 codes if clearly inferable.
- Examination findings — map them onto the examination fields listed below.
- Medications and topicals with correct form (tablet, serum, shampoo, etc.), frequency, duration, instructions.
- Investigations / lab tests ordered (e.g. "CBC", "Ferritin", "TSH") in "testsOrdered".
- Medical advice and follow-up instructions.
- Vitals (only if explicitly written) — return them as strings exactly as written, with units.
- Past history, allergies, surgical history, family history → "doctorNotes".

EXAMINATION TARGET FIELDS ${examSchema.isTemplate
        ? `(the doctor's own template${examSchema.templateName ? `: "${examSchema.templateName}"` : ''} — use these exact keys)`
        : '(standard OPD schema — use these exact keys)'}:
${examSchemaText}

${EXAMINATION_MAPPING_RULES}
${visitContext?.patientAge || visitContext?.patientGender ? `\nPATIENT: ${visitContext?.patientAge || '?'} years, ${visitContext?.patientGender || 'unknown'}` : ''}

📦 OUTPUT FORMAT (return ONLY this JSON):
{
  "chiefComplaint": string | null,
  "symptoms": [
    {
      "name": string,
      "severity": "mild" | "moderate" | "severe" | null,
      "duration": string | null,
      "location": string | null,
      "notes": string | null
    }
  ],
  "vitals": {
    "pulse": string | null,
    "temperature": string | null,
    "bloodPressure": string | null,
    "weight": string | null,
    "height": string | null,
    "respiratoryRate": string | null,
    "oxygenSaturation": string | null
  },
  "examination": { "<sectionId>": { "<fieldKey>": "value" } },
  "diagnoses": [
    { "name": string, "icd10Code": string | null, "notes": string | null, "isPrimary": boolean }
  ],
  "prescriptions": [
    { "medicine": string, "dosage": string, "frequency": string, "duration": string, "instructions": string }
  ],
  "testsOrdered": [
    { "testName": string, "testType": "lab" | "radiology" | "procedure" | "other", "urgency": "routine" | "urgent" | "stat", "instructions": string | null }
  ],
  "advice": [string],
  "followUp": {
    "duration": string | null,
    "instructions": string | null,
    "warningSignsToWatch": [string] | null
  },
  "doctorNotes": string | null,
  "unmappedFindings": [ { "label": string, "value": string } ]
}

RAW OCR TEXT:
${textInput}`;

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json'
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ]
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

    let extractedData;
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (_parseError) {
      // Keep the model output rather than returning an empty record
      extractedData = {
        symptoms: [],
        vitals: {},
        examination: {},
        diagnoses: [],
        prescriptions: [],
        testsOrdered: [],
        advice: [],
        followUp: null,
        chiefComplaint: null,
        doctorNotes: generatedText,
        unmappedFindings: []
      };
    }

    const cleanedData = {
      chiefComplaint: asText(extractedData.chiefComplaint),
      symptoms: Array.isArray(extractedData.symptoms) ? extractedData.symptoms.map((symptom: any) => ({
        name: typeof symptom === 'string' ? symptom : asText(symptom?.name) || '',
        severity: ['mild', 'moderate', 'severe'].includes(symptom?.severity) ? symptom.severity : null,
        duration: asText(symptom?.duration),
        location: asText(symptom?.location),
        notes: asText(symptom?.notes)
      })).filter((s: any) => s.name) : [],
      vitals: {
        temperature: asVital(extractedData.vitals?.temperature),
        bloodPressure: asVital(extractedData.vitals?.bloodPressure),
        pulse: asVital(extractedData.vitals?.pulse),
        weight: asVital(extractedData.vitals?.weight),
        height: asVital(extractedData.vitals?.height),
        respiratoryRate: asVital(extractedData.vitals?.respiratoryRate),
        oxygenSaturation: asVital(extractedData.vitals?.oxygenSaturation)
      },
      examination: (extractedData.examination && typeof extractedData.examination === 'object')
        ? extractedData.examination
        : {},
      diagnoses: Array.isArray(extractedData.diagnoses) ? extractedData.diagnoses.map((diagnosis: any) => ({
        name: typeof diagnosis === 'string' ? diagnosis : asText(diagnosis?.name) || '',
        icd10Code: asText(diagnosis?.icd10Code),
        isPrimary: Boolean(diagnosis?.isPrimary),
        notes: asText(diagnosis?.notes)
      })).filter((d: any) => d.name) : [],
      prescriptions: Array.isArray(extractedData.prescriptions) ? extractedData.prescriptions.map((prescription: any) => ({
        medicine: asText(prescription?.medicine) || '',
        dosage: asText(prescription?.dosage) || '',
        frequency: asText(prescription?.frequency) || '',
        duration: asText(prescription?.duration) || '',
        instructions: asText(prescription?.instructions) || '',
        quantity: typeof prescription?.quantity === 'number' ? prescription.quantity : null,
        refills: typeof prescription?.refills === 'number' ? prescription.refills : null
      })).filter((p: any) => p.medicine) : [],
      testsOrdered: Array.isArray(extractedData.testsOrdered) ? extractedData.testsOrdered.map((test: any) => ({
        testName: typeof test === 'string' ? test : asText(test?.testName) || '',
        testType: ['lab', 'radiology', 'procedure', 'other'].includes(test?.testType) ? test.testType : 'lab',
        instructions: asText(test?.instructions),
        urgency: ['routine', 'urgent', 'stat'].includes(test?.urgency) ? test.urgency : 'routine'
      })).filter((t: any) => t.testName) : [],
      advice: Array.isArray(extractedData.advice) ? extractedData.advice.filter((a: any) => typeof a === 'string' && a.trim()) : [],
      followUp: extractedData.followUp && typeof extractedData.followUp === 'object' ? {
        duration: asText(extractedData.followUp.duration),
        instructions: asText(extractedData.followUp.instructions),
        warningSignsToWatch: Array.isArray(extractedData.followUp.warningSignsToWatch)
          ? extractedData.followUp.warningSignsToWatch.filter((w: any) => typeof w === 'string' && w.trim())
          : null
      } : null,
      doctorNotes: asText(extractedData.doctorNotes),
      unmappedFindings: Array.isArray(extractedData.unmappedFindings)
        ? extractedData.unmappedFindings
          .map((item: any) => (typeof item === 'string'
            ? { label: 'Additional finding', value: item }
            : { label: asText(item?.label) || 'Additional finding', value: asText(item?.value) || '' }))
          .filter((item: any) => item.value)
        : []
    };

    let confidence = 0.5;
    if (cleanedData.symptoms.length > 0) confidence += 0.1;
    if (cleanedData.diagnoses.length > 0) confidence += 0.15;
    if (cleanedData.prescriptions.length > 0) confidence += 0.15;
    if (cleanedData.chiefComplaint) confidence += 0.1;
    if (Object.values(cleanedData.vitals).some((v) => v !== null)) confidence += 0.1;

    return new Response(JSON.stringify({
      success: true,
      extractedData: cleanedData,
      confidence: Math.min(confidence, 1.0),
      examinationSchemaUsed: {
        isTemplate: examSchema.isTemplate,
        templateName: examSchema.templateName,
        sectionCount: examSchema.sections.length
      },
      rawResponse: generatedText,
      ocrUploadId: ocrUploadId || null
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
      error: 'Failed to process text with Gemini API',
      details: message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
