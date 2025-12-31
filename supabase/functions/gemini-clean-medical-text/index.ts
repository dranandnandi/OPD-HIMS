import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { rawText } = await req.json()

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: 'Raw text is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Get API key from Supabase secret
    const apiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Google API key not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const prompt = `You are a medical text cleaning AI specializing in processing raw OCR text from Indian clinical prescriptions and case papers.

Your task is to **extract only the medically relevant content** from the input. You must **remove all non-medical, administrative, or branding information** and return only the core clinical data.

❌ REMOVE all of the following:
- Clinic or hospital names, logos, slogans, addresses
- Doctor names, degrees, titles, and registration numbers
- Phone numbers, emails, websites, appointment timings
- Administrative headers/footers, stationery marks
- Dates unless explicitly tied to a symptom onset or follow-up
- Any promotional lines, branding, or legal disclaimers
- Billing, signature lines, or stamps

✅ KEEP only:
- Patient complaints and symptoms
- Vital signs (e.g., temperature, pulse, BP, height, weight)
- Clinical examination findings and notes
- Diagnoses (including provisional or confirmed)
- Prescribed medications with dosage, frequency, and instructions
- Laboratory or imaging tests ordered
- Medical advice, procedures recommended, and follow-up plans

Instructions:
1. Do NOT interpret or normalize anything — preserve the original clinical language and dosages.
2. Keep the text readable, well-structured, and focused on clinical information only.
3. Do not include any headings or explanation — just the cleaned medical content.
4. If no valid medical content is found, return: "No medical content detected"

Input Text:
${rawText}`;

    // Call Gemini API using API key
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      })
    })

    const geminiData = await geminiResponse.json()

    if (geminiData.error) {
      throw new Error(`Gemini API error: ${geminiData.error.message}`)
    }

    // Extract the generated text
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!generatedText) {
      throw new Error('No response generated from Gemini')
    }

    // Clean up the response
    const cleanedMedicalText = generatedText.trim()

    return new Response(
      JSON.stringify({
        success: true,
        cleanedMedicalText: cleanedMedicalText,
        originalLength: rawText.length,
        cleanedLength: cleanedMedicalText.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to clean medical text with Gemini API',
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})