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
    console.log('🔍 [DEBUG] Request received at gemini-clean-medical-text')
    const { rawText } = await req.json()

    if (!rawText) {
      console.error('❌ [DEBUG] No rawText provided in request')
      return new Response(
        JSON.stringify({ error: 'Raw text is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`📊 [DEBUG] Received text length: ${rawText.length} characters`)

    // Truncate extremely long text to avoid token limits (approx 30k chars = ~7500 tokens)
    const maxChars = 30000
    const truncatedText = rawText.length > maxChars ? rawText.substring(0, maxChars) : rawText
    
    if (rawText.length > maxChars) {
      console.log(`✂️ [DEBUG] Text truncated from ${rawText.length} to ${maxChars} characters`)
    }

    // Get API key from Supabase secret
    const apiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!apiKey) {
      console.error('❌ [DEBUG] ALLGOOGLE_KEY environment variable not found')
      return new Response(
        JSON.stringify({ error: 'Google API key not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }
    console.log('✅ [DEBUG] API key loaded successfully')

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
${truncatedText}`;

    console.log(`🚀 [DEBUG] Calling Gemini 2.5 Flash API...`)
    console.log(`📝 [DEBUG] Prompt length: ${prompt.length} characters`)
    
    // Call Gemini API using API key (using Gemini 2.5 Flash - current standard model)
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
          maxOutputTokens: 8192,
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

    console.log(`📡 [DEBUG] Gemini API response status: ${geminiResponse.status}`)
    const geminiData = await geminiResponse.json()
    console.log(`📦 [DEBUG] Response received, parsing data...`)

    if (geminiData.error) {
      console.error(`❌ [DEBUG] Gemini API error:`, JSON.stringify(geminiData.error, null, 2))
      // Handle specific Gemini API errors
      const errorMsg = geminiData.error.message || 'Unknown error'
      const errorStatus = geminiData.error.status || 'UNKNOWN'
      
      if (errorStatus === 'RESOURCE_EXHAUSTED') {
        throw new Error(`Gemini API quota exhausted. Please try again later or check your API quota.`)
      }
      
      throw new Error(`Gemini API error (${errorStatus}): ${errorMsg}`)
    }

    // Extract the generated text
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''
    console.log(`📝 [DEBUG] Generated text length: ${generatedText.length} characters`)

    if (!generatedText) {
      console.error('❌ [DEBUG] No text generated from Gemini response')
      throw new Error('No response generated from Gemini')
    }

    // Clean up the response
    const cleanedMedicalText = generatedText.trim()
    console.log(`✅ [DEBUG] Successfully cleaned medical text`)
    console.log(`📊 [DEBUG] Stats - Original: ${rawText.length}, Cleaned: ${cleanedMedicalText.length}`)

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
    console.error('💥 [DEBUG] Exception caught:', error.message)
    console.error('💥 [DEBUG] Stack trace:', error.stack)
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