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
    const { userInput } = await req.json()
    
    if (!userInput || typeof userInput !== 'string') {
      return new Response(
        JSON.stringify({ error: 'User input is required and must be a string' }),
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

    const prompt = `You are an expert medical data entry assistant for Indian clinics. Analyze the following user input and determine if it describes a medicine or a medical test/service. Extract all relevant information and suggest structured data for database entry.

User Input: "${userInput}"

Guidelines:
- Identify if this is a MEDICINE or a TEST/SERVICE
- For medicines: Extract name, strength, dosage form, category, manufacturer if mentioned
- For tests: Extract test name, category (blood, cardiac, imaging, neurology, pathology, urine, other), type (lab, radiology, procedure, other)
- Extract pricing information (cost price and selling price)
- Handle Indian medical terminology and abbreviations
- Common test abbreviations: CBC (Complete Blood Count), LFT (Liver Function Test), KFT (Kidney Function Test), ECG/EKG (Electrocardiogram), etc.
- Common procedures: Dressing, Injection, Minor Surgery, Suturing, etc.
- Common medicine categories: tablet, capsule, syrup, injection, cream, ointment, drops, etc.
- Prices in Indian Rupees (₹)

Output the result as a valid JSON object with this exact schema:

{
  "itemType": "medicine" | "test",
  "confidence": number (0.0 to 1.0),
  "suggestedData": {
    "masterData": {
      "name": "string (required)",
      "category": "string (required)",
      "type": "lab|radiology|procedure|other (for tests only)",
      "dosageForm": "tablet|capsule|syrup|injection|cream|ointment|drops|other (for medicines only)",
      "strength": "string (for medicines, e.g., '500mg', '10ml')",
      "genericName": "string (optional)",
      "brandName": "string (optional)",
      "manufacturer": "string (optional)",
      "description": "string (optional)",
      "normalRange": "string (for tests only)",
      "units": "string (for tests only)",
      "preparationInstructions": "string (for tests only)"
    },
    "pricingData": {
      "sellingPrice": number (required),
      "costPrice": number (required, should be lower than selling price)
    }
  },
  "explanation": "string (brief explanation of what was identified and extracted)",
  "suggestions": [
    "string (array of helpful suggestions or clarifications)"
  ]
}

Examples:
- Input: "CBC 300 rs" → Test, Complete Blood Count, lab test, blood category, selling price 300
- Input: "Paracetamol 500mg tablet 50 rs" → Medicine, tablet form, 500mg strength, selling price 50
- Input: "ECG test 200 rupees" → Test, Electrocardiogram, cardiac category, selling price 200
- Input: "Dressing 150 rs" → Procedure, wound dressing, procedure type, selling price 150
- Input: "Minor surgery 2000 rupees" → Procedure, surgical procedure, procedure type, selling price 2000

Important:
- Always provide both costPrice and sellingPrice (costPrice should be 60-80% of sellingPrice)
- Use proper medical terminology
- Categorize appropriately for Indian medical practice
- If unclear, provide best guess with lower confidence score

Return only the JSON object, no additional text.`

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

    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''
    
    if (!generatedText) {
      throw new Error('No response generated from Gemini')
    }

    // Parse the JSON response from Gemini
    let parsedData
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No valid JSON found in Gemini response')
      }
    } catch (parseError) {
      // Fallback response
      parsedData = {
        itemType: "unknown",
        confidence: 0.1,
        suggestedData: {
          masterData: {
            name: userInput,
            category: "other"
          },
          pricingData: {
            sellingPrice: 0,
            costPrice: 0
          }
        },
        explanation: "Failed to parse the input. Please provide more specific information.",
        suggestions: [
          "Try being more specific about the item type (medicine or test)",
          "Include pricing information if available",
          "Use standard medical terminology"
        ]
      }
    }

    // Validate and clean the parsed data
    const cleanedData = {
      itemType: ['medicine', 'test'].includes(parsedData.itemType) ? parsedData.itemType : 'unknown',
      confidence: typeof parsedData.confidence === 'number' ? Math.max(0, Math.min(1, parsedData.confidence)) : 0.5,
      suggestedData: {
        masterData: {
          name: parsedData.suggestedData?.masterData?.name || userInput,
          category: parsedData.suggestedData?.masterData?.category || 'other',
          ...(parsedData.itemType === 'test' && {
            type: ['lab', 'radiology', 'other'].includes(parsedData.suggestedData?.masterData?.type) 
              ? parsedData.suggestedData.masterData.type : 'lab',
            normalRange: parsedData.suggestedData?.masterData?.normalRange || null,
            units: parsedData.suggestedData?.masterData?.units || null,
            preparationInstructions: parsedData.suggestedData?.masterData?.preparationInstructions || null
          }),
          ...(parsedData.itemType === 'medicine' && {
            dosageForm: parsedData.suggestedData?.masterData?.dosageForm || 'tablet',
            strength: parsedData.suggestedData?.masterData?.strength || null,
            genericName: parsedData.suggestedData?.masterData?.genericName || null,
            brandName: parsedData.suggestedData?.masterData?.brandName || null,
            manufacturer: parsedData.suggestedData?.masterData?.manufacturer || null
          }),
          description: parsedData.suggestedData?.masterData?.description || null
        },
        pricingData: {
          sellingPrice: typeof parsedData.suggestedData?.pricingData?.sellingPrice === 'number' 
            ? parsedData.suggestedData.pricingData.sellingPrice : 0,
          costPrice: typeof parsedData.suggestedData?.pricingData?.costPrice === 'number' 
            ? parsedData.suggestedData.pricingData.costPrice : 0
        }
      },
      explanation: parsedData.explanation || 'AI analysis completed',
      suggestions: Array.isArray(parsedData.suggestions) ? parsedData.suggestions : []
    }

    // Auto-calculate cost price if not provided (70% of selling price)
    if (cleanedData.suggestedData.pricingData.costPrice === 0 && cleanedData.suggestedData.pricingData.sellingPrice > 0) {
      cleanedData.suggestedData.pricingData.costPrice = Math.round(cleanedData.suggestedData.pricingData.sellingPrice * 0.7)
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: cleanedData,
        originalInput: userInput
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process input with AI',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})