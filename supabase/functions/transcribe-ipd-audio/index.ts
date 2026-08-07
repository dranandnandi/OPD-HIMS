import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============================================================================
// IPD ward-round dictation → structured chart entries.
// Same engine/model as transcribe-medical-audio (OPD visits); the difference is
// the context (an admitted patient's running chart) and the output shape, which
// maps onto the IPD tables: treatment plan, orders, medications, consultations,
// diet, nursing notes, vitals and tasks.
// ============================================================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Privacy filter — same rules as the OPD dictation function
function filterSensitiveContent(text: string): { filtered: string; redactionCount: number } {
    let filtered = text;
    let redactionCount = 0;

    const sensitivePatterns = [
        /\b(sexual intercourse|coitus|orgasm|masturbat\w+|erotic|pornograph\w+)\b/gi,
        /\b(bank account|credit card|debit card|account number|PIN|password)\b[:\s]*[\d\-]+/gi,
        /(?<!\bphone:?\s?)(?<!\bemergency:?\s?)\b\d{10,}\b/g,
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
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

const EMPTY_RESULT = {
    treatmentPlan: { subjective: null, objective: null, assessment: null, plan: null, advice: null },
    nursingNote: null,
    vitals: {},
    medications: [],
    investigations: [],
    consultations: [],
    diet: null,
    nursingTasks: [],
    intakeOutput: [],
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { audioBase64, mimeType, textInput, admissionContext } = await req.json();

        if (!audioBase64 && !textInput) {
            return new Response(JSON.stringify({ error: 'audioBase64 or textInput is required' }), {
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

        const ctx = admissionContext ?? {};
        const meds: string[] = Array.isArray(ctx.activeMedications) ? ctx.activeMedications : [];
        const problems: string[] = Array.isArray(ctx.activeProblems) ? ctx.activeProblems : [];
        const allergies: string[] = Array.isArray(ctx.allergies) ? ctx.allergies : [];

        const systemPrompt = `You are an expert medical scribe for an Indian hospital's IPD (inpatient) ward.
A doctor or nurse is dictating during or just after a ward round. Transcribe what is said and split it
into the exact chart sections listed below, so each part can be filed into the right field automatically.

ADMITTED PATIENT CONTEXT (use it to resolve pronouns, abbreviations and "continue same"):
- Patient: ${ctx.patientName || 'Unknown'}${ctx.age ? `, ${ctx.age} yrs` : ''}${ctx.gender ? `, ${ctx.gender}` : ''}
- Ward / bed: ${ctx.wardBed || 'not specified'}
- Admitted: ${ctx.admittedOn || 'unknown'} (day ${ctx.dayOfStay ?? '?'} of stay)
- Treating doctor: ${ctx.doctorName || 'unknown'}
- Working diagnosis: ${ctx.diagnosis || 'not recorded'}
- Active problems: ${problems.length ? problems.join('; ') : 'none recorded'}
- Known allergies: ${allergies.length ? allergies.join(', ') : 'none recorded'}
- Medications already running: ${meds.length ? meds.join('; ') : 'none'}
- Current diet order: ${ctx.currentDiet || 'not set'}
- Last documented plan: ${ctx.lastPlan || 'none'}

SECTIONS TO EXTRACT (leave a section empty when nothing was said about it — never invent):

1. treatmentPlan — today's doctor documentation, split SOAP-wise:
   - subjective: how the patient says they are (complaints, sleep, appetite, pain, bowel/bladder)
   - objective: examination findings and observations stated on the round
   - assessment: impression / how the problem is progressing
   - plan: WHAT IS TO BE DONE TODAY — the treatment plan in clear clinical lines
   - advice: instructions to ward staff, attendants, mobilisation, physiotherapy, counselling

2. nursingNote — anything addressed to nursing staff as a note (monitoring, care, observations).
   Keep it separate from the doctor's plan.

3. vitals — only if numbers were spoken. Use plain numbers, metric units:
   temperature (°C), pulse, bpSystolic, bpDiastolic, respRate, spo2 (%), painScore (0-10),
   bloodSugar (mg/dL), weightKg. Convert Fahrenheit to Celsius. "BP 130 by 80" → 130 / 80.

4. medications — every drug started, changed or stopped. One entry per drug:
   - medicine: generic or brand name as spoken
   - dose: e.g. "500 mg", "1 g", "10 units"
   - route: one of oral | iv | im | sc | topical | inhalation | per_rectal | sublingual
   - frequency: one of od | bd | tid | qid | q6h | q8h | q12h | hs | stat | sos
     (map Indian usage: "1-0-1"=bd, "1-1-1"=tid, "TDS"=tid, "QID"=qid, "HS"/"at night"=hs,
      "SOS"/"if needed"/"PRN"=sos, "stat"/"immediately"=stat)
   - days: number of days ordered (default 3 when not stated, 1 for stat)
   - instructions: before/after food, infusion rate, dilution, monitoring
   - action: "start" for a new/changed drug, "stop" when it is being stopped, "continue" when merely continued

5. investigations — tests and imaging ordered. One entry per test:
   - testName: exactly as ordered ("CBC", "Serum creatinine", "Chest X-ray PA", "USG abdomen")
   - category: pathology (blood/urine/lab) | radiology (X-ray, USG, CT, MRI, ECHO) | procedure (biopsy, endoscopy, ECG-type bedside)
   - urgency: routine | urgent | stat
   - instructions: fasting, timing ("tomorrow morning", "6 AM sample"), special preparation

6. consultations — cross / referral opinions asked for:
   - specialty: e.g. "cardiology", "nephrology", "orthopaedics", "physiotherapy"
   - reason: why the opinion is wanted
   - urgency: routine | urgent | stat

7. diet — only if the diet was discussed:
   - dietType: one of normal | soft | liquid | semi_solid | diabetic | renal | cardiac | low_salt |
     high_protein | low_fat | bland | pediatric | npo | other
   - route: oral | ryles_tube | peg | npo | tpn
   - caloriesKcal, proteinG, fluidRestrictionMl: numbers if stated, else null
   - instructions: free-text diet advice
   - restrictions: foods to avoid / allergy-driven restrictions

8. nursingTasks — repeated ward duties asked for (monitoring, dressing, positioning, catheter care):
   - task: what to do
   - recurrence: q4h | q6h | q8h | od | bd | sos | null
   - dueInHours: hours from now for the first occurrence, if a time was stated

9. intakeOutput — only if intake/output volumes were dictated:
   - ioType: intake | output, route (oral/iv/ryles/urine/drain/vomit/stool), volumeMl

OUTPUT JSON ONLY — no markdown, no commentary:
{
  "transcript": "cleaned full transcription",
  "noteKind": "round | nursing | handover | procedure",
  "treatmentPlan": { "subjective": "string or null", "objective": "string or null", "assessment": "string or null", "plan": "string or null", "advice": "string or null" },
  "nursingNote": "string or null",
  "vitals": { "temperature": null, "pulse": null, "bpSystolic": null, "bpDiastolic": null, "respRate": null, "spo2": null, "painScore": null, "bloodSugar": null, "weightKg": null },
  "medications": [ { "medicine": "string", "dose": "string or null", "route": "string or null", "frequency": "string", "days": 3, "instructions": "string or null", "action": "start|stop|continue" } ],
  "investigations": [ { "testName": "string", "category": "pathology|radiology|procedure", "urgency": "routine|urgent|stat", "instructions": "string or null" } ],
  "consultations": [ { "specialty": "string", "reason": "string", "urgency": "routine|urgent|stat" } ],
  "diet": { "dietType": "string", "route": "string", "caloriesKcal": null, "proteinG": null, "fluidRestrictionMl": null, "instructions": "string or null", "restrictions": "string or null" },
  "nursingTasks": [ { "task": "string", "recurrence": "string or null", "dueInHours": null } ],
  "intakeOutput": [ { "ioType": "intake|output", "route": "string", "volumeMl": 0 } ],
  "privacyRedactions": 0,
  "confidence": { "transcription": 0.0, "extraction": 0.0 }
}

RULES:
1. Indian medical shorthand is expected — expand it correctly (T. = tablet, Inj. = injection, Cap. = capsule,
   "sugar" = blood glucose, "BP" = blood pressure, "GRBS"/"RBS" = random blood sugar).
2. A drug named without any instruction to stop is a "start" (new order) unless it is already in the running
   medication list, in which case it is "continue".
3. Never move a doctor's plan into the nursing note or vice versa — they are separate fields.
4. If the dictation is only a progress note, fill treatmentPlan and leave the order arrays empty.
5. Use null for anything not stated. Do not guess doses, frequencies or test names.
6. Keep clinical wording; do not paraphrase into lay language.
7. Return ONLY valid JSON.`;

        const parts: Array<Record<string, unknown>> = [{ text: systemPrompt }];
        if (audioBase64) {
            parts.push({ inline_data: { mime_type: mimeType || 'audio/webm', data: audioBase64 } });
        } else {
            parts.push({ text: `\n\nDICTATION (typed, not audio):\n${textInput}` });
        }

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        temperature: 0.2,
                        topK: 1,
                        topP: 1,
                        maxOutputTokens: 8192
                    }
                })
            }
        );

        const geminiData = await geminiResponse.json();
        if (geminiData.error) {
            throw new Error(`Gemini API error: ${geminiData.error.message}`);
        }

        const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!generatedText) {
            throw new Error('No response generated from Gemini');
        }

        let result: Record<string, unknown>;
        try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No valid JSON found in response');
            result = JSON.parse(jsonMatch[0]);
        } catch {
            result = {
                transcript: textInput || generatedText,
                noteKind: 'round',
                ...EMPTY_RESULT,
                privacyRedactions: 0
            };
        }

        // Defensive defaults so the client never has to null-check every section
        result = { ...EMPTY_RESULT, ...result };

        if (typeof result.transcript === 'string') {
            const { filtered, redactionCount } = filterSensitiveContent(result.transcript);
            result.transcript = filtered;
            result.privacyRedactions = (Number(result.privacyRedactions) || 0) + redactionCount;
        }

        return new Response(JSON.stringify({ success: true, ...result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({
            error: 'Failed to transcribe ward-round dictation',
            details: errorMessage
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
