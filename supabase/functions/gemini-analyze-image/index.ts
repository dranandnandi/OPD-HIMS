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
    const { imageBase64, rawText, imageType, visitContext } = await req.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'imageBase64 is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const apiKey = Deno.env.get('ALLGOOGLE_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Google API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract base64 data (remove data URL prefix if present)
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const mimeType = imageBase64.startsWith('data:') ? imageBase64.split(';')[0].split(':')[1] : 'image/jpeg';

    const isOcrType = imageType === 'case_paper' || imageType === 'lab_report';
    const hasText = rawText && rawText.trim().length > 30;
    const doctorContext = visitContext?.doctorContext;

    let prompt: string;

    if (isOcrType || hasText) {
      // For case papers and lab reports, or when there's substantial OCR text
      prompt = `You are a medical data extraction AI for Indian clinical settings. Analyze this medical image and any extracted text to populate an EMR form.

Image Type: ${imageType || 'unknown'}
${doctorContext ? `\n⚠️ DOCTOR'S SPECIFIC FOCUS (prioritize this in your analysis): "${doctorContext}"` : ''}
${rawText ? `\nOCR Extracted Text:\n${rawText}` : ''}
${visitContext ? `\nCurrent Visit Context (already in EMR, do not duplicate):\nChief Complaint: ${visitContext.chiefComplaint || 'not set'}\nExisting Diagnoses: ${(visitContext.diagnoses || []).join(', ') || 'none'}\nExisting Symptoms: ${(visitContext.symptoms || []).join(', ') || 'none'}` : ''}

Analyze BOTH the image visually AND the OCR text. Extract all medical information and return as JSON:

{
  "imageCategory": "case_paper" | "lab_report" | "clinical_photo" | "xray",
  "structuredData": {
    "symptoms": [{ "name": string, "severity": "mild"|"moderate"|"severe"|null, "duration": string|null, "notes": string|null }],
    "vitals": { "temperature": string|null, "bloodPressure": string|null, "pulse": string|null, "weight": string|null, "height": string|null },
    "diagnoses": [{ "name": string, "icd10Code": string|null, "isPrimary": boolean, "notes": string|null }],
    "prescriptions": [{ "medicine": string, "dosage": string, "frequency": string, "duration": string, "instructions": string }],
    "testsOrdered": [{ "testName": string, "testType": "lab"|"radiology"|"other", "urgency": "routine"|"urgent" }],
    "advice": [string],
    "chiefComplaint": string|null,
    "doctorNotes": string|null
  },
  "description": string
}

For lab reports: put test results (e.g. "Hb: 11.2 g/dL - Low") in structuredData.testsOrdered and abnormal findings in doctorNotes.
For case papers: extract all fields normally.
Return ONLY the JSON object.`;
    } else {
      // For clinical photos (swelling, wound, skin conditions, X-rays without text)
      prompt = `You are a clinical image analysis AI for Indian medical settings. Analyze this clinical photograph and provide a structured medical description for an EMR.

Image Type: ${imageType || 'clinical_photo'}
${doctorContext ? `\n⚠️ DOCTOR'S SPECIFIC FOCUS (this is what the doctor wants you to look for — prioritize and report on this specifically): "${doctorContext}"` : ''}
${visitContext ? `\nCurrent Visit Context:\nChief Complaint: ${visitContext.chiefComplaint || 'not set'}\nDiagnoses: ${(visitContext.diagnoses || []).join(', ') || 'none'}` : ''}

Analyze the image and return JSON:

{
  "imageCategory": "clinical_photo" | "xray" | "case_paper" | "lab_report",
  "structuredData": {
    "symptoms": [],
    "vitals": {},
    "diagnoses": [],
    "prescriptions": [],
    "testsOrdered": [],
    "advice": [],
    "chiefComplaint": null,
    "doctorNotes": string
  },
  "description": string
}

For clinical photos:
- "description": Detailed clinical description (location, size, color, swelling degree, skin changes, etc.)
- "structuredData.doctorNotes": Concise clinical finding suitable for EMR (e.g. "Local examination: Swelling over left cheek ~3cm, tender, erythematous, no fluctuation")
- If visible abnormalities suggest a diagnosis, add to structuredData.diagnoses
- For X-rays: describe findings (fracture, opacity, alignment) in doctorNotes

Return ONLY the JSON object.`;
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              },
              { text: prompt }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096
          }
        })
      }
    );

    const geminiData = await geminiResponse.json();
    if (geminiData.error) {
      throw new Error(`Gemini API error: ${geminiData.error.message}`);
    }

    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let result: any = {};
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch {
      result = {
        imageCategory: imageType || 'other',
        description: generatedText,
        structuredData: { doctorNotes: generatedText }
      };
    }

    return new Response(JSON.stringify({
      success: true,
      imageCategory: result.imageCategory || imageType || 'other',
      structuredData: result.structuredData || {},
      description: result.description || ''
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to analyze image',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
