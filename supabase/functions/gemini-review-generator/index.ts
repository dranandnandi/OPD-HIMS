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

    const { clinicName, doctorName, treatment, date, patientName } = await req.json()
    
    if (!clinicName || !treatment || !date) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clinicName, treatment, date' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const prompt = `Create a simple, natural review for a healthcare clinic in 40-50 words.

Key details:
- Clinic: ${clinicName}
- Date of visit: ${date}
- Treatment/Service: ${treatment}
- Doctor: ${doctorName || 'the medical team'}
${patientName ? `- Patient: ${patientName}` : ''}

Requirements:
- Write in first person as if the patient is writing
- Focus on positive qualities (compassionate care, professional staff, clean clinic, effective treatment)
- Sound authentic and personal, not overly promotional
- Mention specific aspects like staff behavior, clinic environment, or treatment effectiveness
- Keep it between 40-50 words
- No quotation marks
- Use simple, conversational language
- Make it suitable for Google My Business or similar review platforms

IMPORTANT PERSONALIZATION INSTRUCTIONS:
- If the treatment/service mentions common symptoms like "fever", "cold", "cough", "headache", "body ache", "stomach pain", "back pain", "joint pain", "skin problems", "allergies", etc., then personalize the review by mentioning how the treatment helped with that specific symptom
- Examples: 
  * For "fever and headache" → mention "quick relief from fever" or "effective treatment for my headache"
  * For "cold and cough" → mention "helped clear my cold" or "cough improved significantly"
  * For "stomach pain" → mention "stomach issues resolved" or "digestive problems treated well"
- If it's a general consultation or check-up, focus on overall care quality and professionalism
- Make the symptom relief sound natural and genuine, not medical or clinical

Generate only the review text, nothing else.`

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
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 150,
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

    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''
    
    if (!generatedText) {
      throw new Error('No review text generated from Gemini')
    }

    // Clean up the generated text
    const cleanedReview = generatedText
      .trim()
      .replace(/^["']|["']$/g, '') // Remove quotes at start/end
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim()

    return new Response(
      JSON.stringify({ 
        success: true, 
        reviewText: cleanedReview,
        wordCount: cleanedReview.split(' ').length
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to generate AI review',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})