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
    const { imageBase64, fileName } = await req.json()
    
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'Image data is required' }),
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

    // Call Vision API for OCR using API key
    const visionRequest = {
      requests: [{
        image: {
          content: imageBase64.replace(/^data:image\/[a-z]+;base64,/, '')
        },
        features: [{
          type: 'TEXT_DETECTION',
          maxResults: 1
        }]
      }]
    }

    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(visionRequest)
    })

    const visionData = await visionResponse.json()
    
    if (visionData.error) {
      throw new Error(`Vision API error: ${visionData.error.message}`)
    }

    const rawText = visionData.responses?.[0]?.fullTextAnnotation?.text || ''
    
    if (!rawText.trim()) {
      throw new Error('No text could be extracted from the invoice image')
    }

    // Step 2: Process with Gemini for structured data extraction
    const prompt = `You are an expert pharmacy invoice data extraction AI. Analyze the following raw text from a pharmacy supplier invoice and extract structured medicine data.

IMPORTANT GUIDELINES:
- Focus on Indian pharmaceutical products and suppliers
- Handle various invoice formats (table-based, list-based, etc.)
- Extract medicine names, quantities, prices, batch numbers, and expiry dates
- Be precise with numeric values and dates
- If a field cannot be confidently extracted, use null

Raw Invoice Text:
${rawText}

Extract and format the output as a valid JSON object with this exact schema:

{
  "invoiceInfo": {
    "supplierName": "string|null",
    "invoiceNumber": "string|null", 
    "invoiceDate": "YYYY-MM-DD|null",
    "totalAmount": "number|null"
  },
  "medicines": [
    {
      "medicineName": "string (required)",
      "quantity": "number (required, must be positive integer)",
      "unitCostPrice": "number (required, must be positive)",
      "totalCostPrice": "number|null (quantity * unitCostPrice)",
      "batchNumber": "string|null",
      "expiryDate": "YYYY-MM-DD|null",
      "manufacturer": "string|null",
      "strength": "string|null (e.g., '500mg', '10ml')",
      "packSize": "string|null (e.g., '10 tablets', '100ml bottle')"
    }
  ]
}

EXTRACTION RULES:
1. Medicine names should be clean and standardized (remove extra spaces, fix common OCR errors)
2. Quantities must be positive integers
3. Prices should be numeric values only (remove currency symbols)
4. Dates should be in YYYY-MM-DD format
5. If multiple medicines are listed, extract all of them
6. Ensure each medicine has at minimum: medicineName, quantity, unitCostPrice

Return only the JSON object, no additional text or formatting.`

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
          maxOutputTokens: 4096,
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
    let extractedData
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No valid JSON found in Gemini response')
      }
    } catch (parseError) {
      // Fallback response
      extractedData = {
        invoiceInfo: {
          supplierName: null,
          invoiceNumber: null,
          invoiceDate: null,
          totalAmount: null
        },
        medicines: []
      }
    }

    // Validate and clean the extracted data
    const cleanedData = {
      invoiceInfo: {
        supplierName: extractedData.invoiceInfo?.supplierName || null,
        invoiceNumber: extractedData.invoiceInfo?.invoiceNumber || null,
        invoiceDate: extractedData.invoiceInfo?.invoiceDate || null,
        totalAmount: typeof extractedData.invoiceInfo?.totalAmount === 'number' ? extractedData.invoiceInfo.totalAmount : null
      },
      medicines: Array.isArray(extractedData.medicines) ? extractedData.medicines.map((medicine: any) => ({
        medicineName: medicine.medicineName || '',
        quantity: typeof medicine.quantity === 'number' && medicine.quantity > 0 ? medicine.quantity : 1,
        unitCostPrice: typeof medicine.unitCostPrice === 'number' && medicine.unitCostPrice > 0 ? medicine.unitCostPrice : 0,
        totalCostPrice: typeof medicine.totalCostPrice === 'number' ? medicine.totalCostPrice : (medicine.quantity || 1) * (medicine.unitCostPrice || 0),
        batchNumber: medicine.batchNumber || null,
        expiryDate: medicine.expiryDate || null,
        manufacturer: medicine.manufacturer || null,
        strength: medicine.strength || null,
        packSize: medicine.packSize || null
      })).filter((m: any) => m.medicineName && m.medicineName.trim()) : []
    }

    // Calculate confidence score
    let confidence = 0.5 // Base confidence
    if (cleanedData.invoiceInfo.supplierName) confidence += 0.1
    if (cleanedData.invoiceInfo.invoiceNumber) confidence += 0.1
    if (cleanedData.medicines.length > 0) confidence += 0.2
    if (cleanedData.medicines.some(m => m.batchNumber)) confidence += 0.1

    return new Response(
      JSON.stringify({ 
        success: true, 
        extractedData: cleanedData,
        confidence: Math.min(confidence, 1.0),
        rawText: rawText,
        fileName: fileName || 'invoice.jpg'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process pharmacy invoice',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})