import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { rawText, cleanedMedicalText, ocrUploadId } = await req.json();
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

    const prompt = `You are a highly accurate medical data extraction AI specialized in Indian clinical case papers. Your task is to extract clinically relevant data from raw OCR-scanned text written by Indian doctors and return it as a structured JSON object using the exact schema provided below.

🌟 OBJECTIVE:
Parse the input text carefully, identify clinical information, and represent it in the structured schema. Pay close attention to format, terminology, and correctness. Normalize where applicable, but never fabricate missing data.

❌ COMMON MISTAKES TO AVOID:
- Do NOT skip symptoms like "Hair fall" or "Diffuse thinning" if mentioned.
- Do NOT mislabel external-use items (e.g. shampoo, serum) as “tablet.”
- Do NOT assign arbitrary durations if they are not present in the source.
- Do NOT leave ICD-10 codes empty if a known diagnosis clearly maps (e.g., MPB → "L64.0").
- Do NOT include clinic branding, addresses, doctor names, or administrative content.

✅ WHAT TO INCLUDE:
- Symptoms and complaints exactly as mentioned.
- Diagnoses with clinical notes (e.g., “Grade-III”), and ICD-10 codes if clearly inferable.
- Medications and topicals with correct form (tablet, serum, shampoo, etc.), frequency, duration, and instructions.
- Medical advice and follow-up instructions.
✅ Include any test orders or lab investigations (e.g., "CBC", "Ferritin", "TSH") under the 'advice' field.
- Vitals (only if explicitly mentioned in the text).

📦 OUTPUT FORMAT (JSON):
{
  "symptoms": [string],
  "diagnoses": [
    {
      "name": string,
      "icd10Code": string | null,
      "notes": string | null,
      "isPrimary": boolean
    }
  ],
  "vitals": {
    "pulse": string,
    "temperature": string,
    "bloodPressure": string,
    "weight": string,
    "height": string
  },
  "prescriptions": [
    {
      "medicine": string,
      "dosage": string,
      "frequency": string,
      "duration": string,
      "instructions": string
    }
  ],
  "advice": [string]  // Includes follow-up, procedures, and test orders
}

RAW OCR TEXT:
${textInput}`;

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 4096
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
    } catch (parseError) {
      extractedData = {
        symptoms: [],
        vitals: {
          temperature: null,
          bloodPressure: null,
          pulse: null,
          weight: null,
          height: null,
          respiratoryRate: null,
          oxygenSaturation: null
        },
        diagnoses: [],
        prescriptions: [],
        testsOrdered: [],
        advice: [],
        chiefComplaint: null,
        doctorNotes: null
      };
    }

    const cleanedData = {
      symptoms: Array.isArray(extractedData.symptoms) ? extractedData.symptoms.map((symptom) => ({
        name: typeof symptom === 'string' ? symptom : symptom.name || '',
        severity: ['mild', 'moderate', 'severe'].includes(symptom?.severity) ? symptom.severity : null,
        duration: symptom?.duration || null,
        notes: symptom?.notes || null
      })).filter((s) => s.name) : [],
      vitals: {
        temperature: typeof extractedData.vitals?.temperature === 'number' ? extractedData.vitals.temperature : null,
        bloodPressure: typeof extractedData.vitals?.bloodPressure === 'string' ? extractedData.vitals.bloodPressure : null,
        pulse: typeof extractedData.vitals?.pulse === 'number' ? extractedData.vitals.pulse : null,
        weight: typeof extractedData.vitals?.weight === 'number' ? extractedData.vitals.weight : null,
        height: typeof extractedData.vitals?.height === 'number' ? extractedData.vitals.height : null,
        respiratoryRate: typeof extractedData.vitals?.respiratoryRate === 'number' ? extractedData.vitals.respiratoryRate : null,
        oxygenSaturation: typeof extractedData.vitals?.oxygenSaturation === 'number' ? extractedData.vitals.oxygenSaturation : null
      },
      diagnoses: Array.isArray(extractedData.diagnoses) ? extractedData.diagnoses.map((diagnosis) => ({
        name: diagnosis.name || '',
        icd10Code: diagnosis.icd10Code || null,
        isPrimary: Boolean(diagnosis.isPrimary),
        notes: diagnosis.notes || null
      })).filter((d) => d.name) : [],
      prescriptions: Array.isArray(extractedData.prescriptions) ? extractedData.prescriptions.map((prescription) => ({
        medicine: prescription.medicine || '',
        dosage: prescription.dosage || '1 tablet',
        frequency: prescription.frequency || 'BD',
        duration: prescription.duration || '5 days',
        instructions: prescription.instructions || 'After meals',
        quantity: typeof prescription.quantity === 'number' ? prescription.quantity : null,
        refills: typeof prescription.refills === 'number' ? prescription.refills : null
      })).filter((p) => p.medicine) : [],
      testsOrdered: Array.isArray(extractedData.testsOrdered) ? extractedData.testsOrdered.map((test) => ({
        testName: test.testName || '',
        testType: ['lab', 'radiology', 'other'].includes(test.testType) ? test.testType : 'lab',
        instructions: test.instructions || null,
        urgency: ['routine', 'urgent', 'stat'].includes(test.urgency) ? test.urgency : 'routine'
      })).filter((t) => t.testName) : [],
      advice: Array.isArray(extractedData.advice) ? extractedData.advice.filter((a) => typeof a === 'string' && a.trim()) : [],
      chiefComplaint: typeof extractedData.chiefComplaint === 'string' ? extractedData.chiefComplaint : null,
      doctorNotes: typeof extractedData.doctorNotes === 'string' ? extractedData.doctorNotes : null
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
      rawResponse: generatedText,
      ocrUploadId: ocrUploadId || null
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to process text with Gemini API',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
