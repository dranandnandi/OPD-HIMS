import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============================================================================
// IPD document dictation → text routed into the document's own sections.
//
// Unlike transcribe-ipd-audio (which files a ward round into chart tables),
// this function is told which fields the document in front of the clinician
// actually has — the headings of the discharge summary / OT note / consent
// form being edited — and returns the dictated content already assigned to
// those fields, ready to be written into the draft.
// ============================================================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Privacy filter — same rules as the ward-round dictation function
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

const MODES = ['replace', 'append'];

interface DocField {
    id: string;
    label: string;
    currentText?: string;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { audioBase64, mimeType, textInput, documentContext } = await req.json();

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

        const ctx = documentContext ?? {};
        const fields: DocField[] = Array.isArray(ctx.fields) ? ctx.fields : [];
        const allergies: string[] = Array.isArray(ctx.allergies) ? ctx.allergies : [];

        if (fields.length === 0) {
            return new Response(JSON.stringify({ error: 'documentContext.fields is required — the document has no sections to dictate into' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // The exact menu of fields the model may write into. Existing content is
        // included (trimmed) so it can continue a section instead of contradicting it.
        const fieldMenu = fields
            .map((f, i) => {
                const current = (f.currentText ?? '').trim();
                const preview = current.length > 400 ? `${current.slice(0, 400)}…` : current;
                return `${i + 1}. id="${f.id}" — "${f.label}"\n   currently: ${preview || '(empty)'}`;
            })
            .join('\n');

        const systemPrompt = `You are an expert medical scribe for an Indian hospital's IPD (inpatient) ward.
A doctor is dictating the content of a clinical document that is open in front of them. Transcribe what is
said and assign each part of it to the correct SECTION of that document, so it can be written straight
into the draft.

🚨 THE GOLDEN RULE — NOTHING MAY BE LOST:
Every clinically relevant statement in the dictation must appear somewhere in your JSON output — either
inside a section, or in "additionalNotes". Silently dropping information is a serious error.
Inventing information is equally serious: never write a finding, a drug, a date or a number that was not
dictated and is not already in the document.

DOCUMENT BEING WRITTEN
- Type: ${ctx.docTypeLabel || ctx.docType || 'Clinical document'}
- Document no: ${ctx.documentNumber || 'draft'}

PATIENT CONTEXT (to resolve pronouns, abbreviations and "same as before"):
- Patient: ${ctx.patientName || 'Unknown'}${ctx.age ? `, ${ctx.age} yrs` : ''}${ctx.gender ? `, ${ctx.gender}` : ''}
- Admission no: ${ctx.admissionNumber || 'unknown'} · Ward / bed: ${ctx.wardBed || 'not specified'}
- Admitted: ${ctx.admittedOn || 'unknown'}${ctx.dischargedOn ? ` · Discharged: ${ctx.dischargedOn}` : ''}
- Treating doctor: ${ctx.doctorName || 'unknown'}
- Working diagnosis: ${ctx.diagnosis || 'not recorded'}
- Reason for admission: ${ctx.reasonForAdmission || 'not recorded'}
- Known allergies: ${allergies.length ? allergies.join(', ') : 'none recorded'}

SECTIONS AVAILABLE IN THIS DOCUMENT — you may ONLY use these ids:
${fieldMenu}

HOW TO ASSIGN
1. Route each dictated statement to the section it clinically belongs to. Use the section's own meaning,
   not the order it was dictated in ("she is being sent home on these tablets" → the discharge medication
   section, even if it was said first).
2. "mode" tells the app what to do with the section:
   - "replace" — the dictation is the section's content now (use this when the section is empty, or when
     the doctor is clearly restating it, e.g. "condition at discharge: stable, afebrile").
   - "append"  — the dictation adds to what is already there (use this when existing content must be kept,
     e.g. "also add to the advice, no driving for two weeks").
   Prefer "append" whenever the section already has content that is still true.
3. Write finished clinical prose in the register of the document — not a transcript of speech. Do not
   prefix with the section name. Do not add headings.
4. Multiple lines/points for one section: separate them with newlines, and start a line with "- " when it
   should be a bullet (medications, advice points, instructions).
5. If content plainly belongs to a section the document does NOT have, create ONE new section for it:
   set "fieldId": "new" and give a short "heading". Do this sparingly — only when nothing existing fits.
6. Anything that is not document content (asides, corrections, instructions to staff) goes into
   "additionalNotes". Never invent a section for it.
7. Leave a section out of the array entirely when nothing was dictated about it. Never emit a section
   with empty text, and never copy a section's existing content back unchanged.

OUTPUT JSON ONLY — no markdown, no commentary:
{
  "transcript": "cleaned full transcription of what was said",
  "sections": [
    { "fieldId": "id from the list above, or \\"new\\"", "heading": "only when fieldId is \\"new\\"", "text": "clinical prose for that section", "mode": "replace|append" }
  ],
  "additionalNotes": "string or null",
  "privacyRedactions": 0,
  "confidence": { "transcription": 0.0, "assignment": 0.0 }
}

RULES:
1. Indian medical shorthand is expected — expand it correctly (T. = tablet, Inj. = injection, Cap. = capsule,
   "sugar" = blood glucose, "BP" = blood pressure, "GRBS"/"RBS" = random blood sugar, "1-0-1" = twice daily,
   "TDS" = three times a day, "HS" = at bedtime, "SOS"/"PRN" = as needed).
2. Keep drug names, doses, routes and frequencies exactly as dictated. Do not normalise a dose you are
   unsure of and do not add a duration that was not stated.
3. Keep clinical wording; do not paraphrase into lay language and do not pad with filler sentences.
4. Dates spoken as "day after tomorrow" / "in one week" stay as spoken — do not compute a calendar date.
5. Return ONLY valid JSON.
6. Before answering, re-read the dictation: is every clinical statement represented in "sections" or
   "additionalNotes"? Anything unaccounted for goes into "additionalNotes".`;

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
                        maxOutputTokens: 8192,
                        responseMimeType: 'application/json'
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
            // Never lose the dictation: hand the raw model output back as notes
            // rather than returning an empty result.
            result = {
                transcript: textInput || generatedText,
                sections: [],
                additionalNotes: generatedText,
                privacyRedactions: 0,
                parseError: true
            };
        }

        // --- normalise the sections against the fields we actually offered ----
        const knownIds = new Set(fields.map((f) => f.id));
        const orphaned: string[] = [];
        const sections = (Array.isArray(result.sections) ? result.sections : [])
            .map((s: Record<string, unknown>) => {
                const text = String(s?.text ?? '').trim();
                if (!text) return null;
                const fieldId = String(s?.fieldId ?? '').trim();
                const heading = String(s?.heading ?? '').trim();
                const mode = MODES.includes(String(s?.mode)) ? String(s.mode) : 'append';

                if (knownIds.has(fieldId)) return { fieldId, heading: '', text, mode };
                // Unknown id with a heading → a genuinely new section; without one
                // there is nowhere to put it, so it falls through to the notes.
                if (heading) return { fieldId: 'new', heading, text, mode: 'replace' };
                orphaned.push(text);
                return null;
            })
            .filter(Boolean);

        result.sections = sections;
        if (orphaned.length > 0) {
            result.additionalNotes = [result.additionalNotes, ...orphaned]
                .filter(Boolean)
                .join('\n');
        }

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
            error: 'Failed to transcribe document dictation',
            details: errorMessage
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
