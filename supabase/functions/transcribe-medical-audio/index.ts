import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
        const { audioBase64, mimeType, visitContext } = await req.json();

        if (!audioBase64) {
            return new Response(JSON.stringify({
                error: 'audioBase64 is required'
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

        // Build comprehensive prompt for medical transcription and extraction
        // Include examination template if provided
        const hasExamTemplate = visitContext?.examinationTemplate?.sections?.length > 0;
        const examTemplateInfo = hasExamTemplate
            ? `\n\nEXAMINATION TEMPLATE (Doctor has created specific fields - FILL THESE):\n${JSON.stringify(visitContext.examinationTemplate.sections, null, 2)}\n\n**IMPORTANT**: The doctor has created a custom examination template. Extract examination findings into the EXACT fields defined in this template. Match field keys precisely (e.g., if template has "pallor", "icterus", use those exact keys in your examination output).`
            : '';

        const systemPrompt = `You are an expert medical transcription AI specialized in doctor-patient consultations in Indian OPD (Outpatient Department) settings.

YOUR TASK:
1. Transcribe the audio accurately, preserving medical terminology
2. Extract ALL clinically relevant information comprehensively
3. Infer structured data even from casual conversation
4. Suggest probable diagnoses based on symptoms discussed
5. Filter only very sensitive non-clinical info (financial, personal IDs)

EXISTING VISIT CONTEXT (use to enhance extraction):
- Chief Complaint Entered: ${visitContext?.chiefComplaint || 'Not entered yet'}
- Symptoms Already Added: ${visitContext?.currentSymptoms?.join(', ') || 'None added yet'}${examTemplateInfo}

EXTRACTION GUIDELINES:

**CHIEF COMPLAINT**: Extract the main reason for visit if discussed. Should be a brief 2-5 word summary.

**SYMPTOMS**: Extract with FULL DETAILS:
- name: The symptom name (e.g., "abdominal pain", "fever", "cough")
- location: Body location if mentioned (e.g., "right side", "lower back", "chest")
- duration: How long (e.g., "2 days", "since morning", "1 week")
- severity: mild/moderate/severe (infer from description - "little pain"=mild, "severe/unbearable"=severe)
- pattern: When it occurs (e.g., "all day", "at night", "after eating", "intermittent")
- character: Type of symptom (e.g., "sharp pain", "dull ache", "burning", "cramping")
- associatedSymptoms: Other symptoms mentioned together
- aggravatingFactors: What makes it worse
- relievingFactors: What makes it better

**VITALS**: Extract any mentioned:
- temperature, bloodPressure, pulse, weight, height, oxygenSaturation, respiratoryRate

**PHYSICAL EXAMINATION**: ${hasExamTemplate
                ? `CRITICAL: Use the examination template fields provided above. Extract findings into those EXACT field keys. For example, if the template has fields like "pallor", "icterus", "consciousness" - use those exact keys in your examination output.`
                : `Extract any examination findings discussed:
- general: Overall appearance, consciousness level
- abdomen: Tenderness, distension, organomegaly
- cardiovascular: Heart sounds, murmurs
- respiratory: Breath sounds, crepitations
- neurological: Reflexes, motor/sensory findings
- other: Any other system findings`}

**DIAGNOSES**: 
- Extract any diagnoses the doctor mentions or confirms
- Include ICD-10 codes if you know them

**DIFFERENTIAL DIAGNOSES**: 
- AI-suggested possible diagnoses based on symptoms discussed
- Rank by likelihood

**PRESCRIPTIONS**: Extract any medications discussed:
- medicine: Drug name
- dosage: Amount per dose
- frequency: How often (e.g., "twice daily", "BD", "TDS")
- duration: For how long
- instructions: Special instructions (before/after food, etc.)
- route: oral/topical/injection etc.

**TESTS ORDERED**: Any lab tests or imaging ordered:
- testName: Name of test
- testType: lab/imaging/procedure
- urgency: routine/urgent
- instructions: Any special prep

**ADVICE**: Lifestyle advice, precautions, do's and don'ts

**FOLLOW UP**: When to return, any warning signs to watch for

OUTPUT JSON FORMAT (return ONLY this JSON, no other text):
{
  "transcript": "Full cleaned transcription of the conversation",
  "chiefComplaint": "Brief 2-5 word chief complaint if extractable",
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
    "examination": ${hasExamTemplate
                ? `{
      // Use EXACT field keys from the examination template
      // For each section in the template, create a nested object with the field keys
      // Example: if template has section "general" with fields ["pallor", "icterus"], output:
      // "general": { "pallor": "present/absent/value", "icterus": "present/absent/value" }
      // Match the template structure EXACTLY
    }`
                : `{
      "general": "string or null",
      "abdomen": "string or null",
      "cardiovascular": "string or null",
      "respiratory": "string or null",
      "neurological": "string or null",
      "localExamination": "string or null",
      "other": {}
    }`},
    "diagnoses": [
      {
        "name": "string",
        "icd10Code": "string or null",
        "isPrimary": true/false,
        "notes": "string or null"
      }
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
      {
        "testName": "string",
        "testType": "lab|imaging|procedure",
        "urgency": "routine|urgent",
        "instructions": "string or null"
      }
    ],
    "advice": ["array of advice strings"],
    "followUp": {
      "duration": "string or null",
      "instructions": "string or null",
      "warningSignsToWatch": ["array"] or null
    }
  },
  "suggestedDiagnoses": [
    {
      "name": "string",
      "likelihood": "high|medium|low",
      "reasoning": "brief explanation"
    }
  ],
  "privacyRedactions": 0,
  "confidence": {
    "transcription": 0.0-1.0,
    "extraction": 0.0-1.0
  }
}

IMPORTANT RULES:
1. Extract EVERYTHING mentioned, even casually
2. For the example "right side pain for 2 days, constant" extract: location="right side", duration="2 days", pattern="constant/all day"
3. Infer severity from context: "little pain" = mild, "can't bear" = severe
4. If doctor mentions a diagnosis even tentatively, extract it
5. ${hasExamTemplate ? '**CRITICAL**: Use the EXACT field keys from the examination template provided. Match the template structure precisely.' : ''}
6. Return ONLY valid JSON, no markdown, no explanation
7. Use null for fields not mentioned, don't omit them`;

        // Call Gemini with audio
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: systemPrompt },
                        {
                            inline_data: {
                                mime_type: mimeType || 'audio/webm',
                                data: audioBase64
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.2,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 8192
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
        } catch (parseError) {
            result = {
                transcript: generatedText,
                extractedFields: {
                    symptoms: [],
                    vitals: {},
                    examination: {},
                    diagnoses: [],
                    prescriptions: [],
                    advice: []
                },
                suggestedDiagnoses: [],
                privacyRedactions: 0
            };
        }

        // Apply additional privacy filtering to transcript
        if (result.transcript) {
            const { filtered, redactionCount } = filterSensitiveContent(result.transcript);
            result.transcript = filtered;
            result.privacyRedactions = (result.privacyRedactions || 0) + redactionCount;
        }

        return new Response(JSON.stringify({
            success: true,
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
