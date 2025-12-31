import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Specialty-specific examination templates
const specialtyBaseTemplates: Record<string, { general: string[], systemic: { id: string; title: string; fields: string[] }[], local: string[] }> = {
    cardiology: {
        general: ['consciousness', 'pallor', 'cyanosis', 'clubbing', 'edema', 'jvp'],
        systemic: [
            { id: 'cardiovascular', title: 'Cardiovascular System', fields: ['heartSounds', 'murmurs', 'thrills', 'pericardialRub', 'apexBeat', 'peripheralPulses'] },
            { id: 'respiratory', title: 'Respiratory System', fields: ['breathSounds', 'crackles', 'wheeze'] }
        ],
        local: []
    },
    orthopedics: {
        general: ['consciousness', 'pallor', 'gait'],
        systemic: [],
        local: ['site', 'swelling', 'deformity', 'tenderness', 'rangeOfMotion', 'crepitus', 'muscleWasting', 'neurovascularStatus']
    },
    dermatology: {
        general: ['pallor', 'icterus', 'lymphadenopathy'],
        systemic: [],
        local: ['lesionType', 'distribution', 'color', 'surface', 'borders', 'base', 'arrangement', 'specialTests']
    },
    gastroenterology: {
        general: ['consciousness', 'pallor', 'icterus', 'edema', 'lymphadenopathy'],
        systemic: [
            { id: 'abdomen', title: 'Abdominal Examination', fields: ['inspection', 'palpation', 'percussion', 'auscultation', 'liver', 'spleen', 'ascites', 'hernialOrifices'] }
        ],
        local: []
    },
    pulmonology: {
        general: ['consciousness', 'cyanosis', 'clubbing', 'respiratoryDistress', 'accessoryMuscleUse'],
        systemic: [
            { id: 'respiratory', title: 'Respiratory System', fields: ['chestShape', 'trachea', 'breathSounds', 'vocalResonance', 'percussion', 'crackles', 'wheeze', 'rhonchi'] }
        ],
        local: []
    },
    neurology: {
        general: ['consciousness', 'orientation', 'speech', 'gait', 'posture'],
        systemic: [
            { id: 'cns', title: 'Central Nervous System', fields: ['cranialNerves', 'motorSystem', 'sensorySystem', 'reflexes', 'coordination', 'meningealSigns'] }
        ],
        local: []
    },
    general: {
        general: ['consciousness', 'pallor', 'icterus', 'cyanosis', 'clubbing', 'lymphadenopathy', 'edema'],
        systemic: [
            { id: 'cvs', title: 'Cardiovascular', fields: ['heartSounds', 'murmurs'] },
            { id: 'rs', title: 'Respiratory', fields: ['breathSounds', 'adventitious'] },
            { id: 'abdomen', title: 'Abdomen', fields: ['soft', 'tenderness', 'organomegaly'] },
            { id: 'cns', title: 'CNS', fields: ['orientation', 'motorPower', 'reflexes'] }
        ],
        local: []
    }
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { doctorSpecialization, chiefComplaint, symptoms, patientAge, patientGender } = await req.json();

        if (!doctorSpecialization) {
            return new Response(JSON.stringify({
                error: 'doctorSpecialization is required'
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

        // Normalize specialization
        const normalizedSpec = doctorSpecialization.toLowerCase().replace(/[^a-z]/g, '');
        const baseTemplate = specialtyBaseTemplates[normalizedSpec] || specialtyBaseTemplates['general'];

        const prompt = `You are a medical examination template generator. Based on the doctor's specialization and patient presentation, generate a contextual physical examination template.

CONTEXT:
- Doctor Specialization: ${doctorSpecialization}
- Chief Complaint: ${chiefComplaint || 'Not specified'}
- Symptoms: ${symptoms?.join(', ') || 'Not specified'}
- Patient Age: ${patientAge || 'Not specified'}
- Patient Gender: ${patientGender || 'Not specified'}

BASE TEMPLATE FIELDS TO BUILD UPON:
- General: ${baseTemplate.general.join(', ')}
- Systemic: ${JSON.stringify(baseTemplate.systemic)}
- Local: ${baseTemplate.local.join(', ')}

TASK:
Generate a JSON examination template with these requirements:
1. Include all relevant fields based on the complaint and specialization
2. Add placeholder values where appropriate
3. Use field types: "text", "select", "toggle", or "textarea"
4. For "select" fields, include relevant options
5. Group fields into logical sections

OUTPUT JSON SCHEMA:
{
  "sections": [
    {
      "id": "string (e.g., 'general', 'cardiovascular')",
      "title": "string (e.g., 'General Examination')",
      "fields": [
        {
          "key": "string (camelCase field name)",
          "label": "string (Human readable label)",
          "type": "text" | "select" | "toggle" | "textarea",
          "value": "string or boolean (default empty or false)",
          "options": ["array of options for select type"],
          "placeholder": "string (hint text)"
        }
      ]
    }
  ],
  "aiGenerated": true,
  "specialization": "${doctorSpecialization}"
}

Generate a clinically appropriate template. Return ONLY the JSON, no explanation.`;

        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 4096
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

        let examinationTemplate;
        try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                examinationTemplate = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No valid JSON found in response');
            }
        } catch (parseError) {
            // Fallback to base template if AI fails
            examinationTemplate = {
                sections: [
                    {
                        id: 'general',
                        title: 'General Examination',
                        fields: baseTemplate.general.map(field => ({
                            key: field,
                            label: field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
                            type: 'text',
                            value: '',
                            placeholder: 'Enter finding...'
                        }))
                    },
                    ...baseTemplate.systemic.map(sys => ({
                        id: sys.id,
                        title: sys.title,
                        fields: sys.fields.map(field => ({
                            key: field,
                            label: field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
                            type: 'text',
                            value: '',
                            placeholder: 'Enter finding...'
                        }))
                    })),
                    ...(baseTemplate.local.length > 0 ? [{
                        id: 'local',
                        title: 'Local Examination',
                        fields: baseTemplate.local.map(field => ({
                            key: field,
                            label: field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
                            type: 'text',
                            value: '',
                            placeholder: 'Enter finding...'
                        }))
                    }] : [])
                ],
                aiGenerated: true,
                specialization: doctorSpecialization
            };
        }

        // Ensure required fields
        examinationTemplate.aiGenerated = true;
        examinationTemplate.specialization = doctorSpecialization;
        examinationTemplate.generatedAt = new Date().toISOString();

        return new Response(JSON.stringify({
            success: true,
            template: examinationTemplate
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to generate examination template',
            details: error.message
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
