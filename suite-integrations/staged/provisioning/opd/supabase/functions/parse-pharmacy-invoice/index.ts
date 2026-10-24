import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64, fileName, mimeType } = await req.json()

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

    // Clean the base64 string
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '')

    const prompt = `You are an expert pharmacy invoice data extraction AI. Analyze this image of a pharmacy supplier invoice directly.

IMPORTANT GUIDELINES:
- Focus on Indian pharmaceutical products and suppliers
- Extract medicine names, quantities, prices, batch numbers, and expiry dates
- Extract GST details: supplier GSTIN, HSN code per line, GST % per line, MRP, discount %, free/scheme quantity, and the invoice tax totals
- "unitCostPrice" is the GST-EXCLUSIVE purchase rate per unit (the "Rate" column), NOT the MRP
- Indian pharma invoices usually show CGST and SGST as two equal halves (e.g. 6% + 6% = 12% GST); report the combined gstRate
- Be precise with numeric values and dates
- If a field cannot be confidently extracted, use null

Extract and format the output as a valid JSON object with this exact schema:

{
  "raw_text": "string (all visible text)",
  "invoiceInfo": {
    "supplierName": "string|null",
    "supplierGstin": "string|null (15 characters)",
    "invoiceNumber": "string|null",
    "invoiceDate": "YYYY-MM-DD|null",
    "taxableAmount": "number|null (invoice total before GST)",
    "cgstAmount": "number|null",
    "sgstAmount": "number|null",
    "igstAmount": "number|null",
    "totalAmount": "number|null (grand total payable)"
  },
  "medicines": [
    {
      "medicineName": "string (required, include strength if visible)",
      "quantity": "number (required, must be positive integer)",
      "unitCostPrice": "number (required, must be positive)",
      "totalCostPrice": "number (quantity * unitCostPrice)",
      "batchNumber": "string|null",
      "expiryDate": "YYYY-MM-DD|null (if only MM/YY is printed, use the last day of that month)",
      "manufacturer": "string|null",
      "strength": "string|null (e.g., '500mg', '10ml')",
      "packSize": "string|null (e.g., '10 tablets', '100ml bottle')",
      "hsnCode": "string|null (4-8 digits, usually 3004)",
      "gstRate": "number|null (combined GST %: 0, 5, 12, 18 or 28)",
      "mrp": "number|null (printed MRP per unit)",
      "discountPercent": "number|null (line discount %)",
      "discountAmount": "number|null (flat line discount in rupees, when printed as an amount instead of %)",
      "freeQuantity": "number|null (scheme / free units)"
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

    // Call Gemini 2.5 Flash API (multimodal)
    const geminiResponse = await runtimeFetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "image/jpeg", // Assuming JPEG/PNG images for this specific function (parse-pharmacy-invoice)
                data: cleanBase64
              }
            }
          ]
        }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      })
    })

    const geminiData = await geminiResponse.json()

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${geminiData.error?.message || geminiResponse.statusText}`)
    }

    const candidates = geminiData.candidates
    if (!candidates || candidates.length === 0) {
      throw new Error('No content generated by Gemini')
    }

    const textResponse = candidates[0].content.parts[0].text
    let extractedData
    try {
      extractedData = JSON.parse(textResponse)
    } catch (e) {
      // Fallback or retry parsing
      extractedData = {
        raw_text: "Error parsing JSON",
        invoiceInfo: {},
        medicines: []
      }
    }

    const rawText = extractedData.raw_text || ''

    // Validate and clean (Gemini 2.0 usually follows schema well, but good to be safe)
    const cleanedData = {
      invoiceInfo: {
        supplierName: extractedData.invoiceInfo?.supplierName || null,
        supplierGstin: typeof extractedData.invoiceInfo?.supplierGstin === 'string'
          ? extractedData.invoiceInfo.supplierGstin.replace(/\s+/g, '').toUpperCase() : null,
        invoiceNumber: extractedData.invoiceInfo?.invoiceNumber || null,
        invoiceDate: extractedData.invoiceInfo?.invoiceDate || null,
        taxableAmount: typeof extractedData.invoiceInfo?.taxableAmount === 'number' ? extractedData.invoiceInfo.taxableAmount : null,
        cgstAmount: typeof extractedData.invoiceInfo?.cgstAmount === 'number' ? extractedData.invoiceInfo.cgstAmount : null,
        sgstAmount: typeof extractedData.invoiceInfo?.sgstAmount === 'number' ? extractedData.invoiceInfo.sgstAmount : null,
        igstAmount: typeof extractedData.invoiceInfo?.igstAmount === 'number' ? extractedData.invoiceInfo.igstAmount : null,
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
        packSize: medicine.packSize || null,
        hsnCode: medicine.hsnCode ? String(medicine.hsnCode).replace(/\D/g, '') || null : null,
        gstRate: [0, 5, 12, 18, 28].includes(Number(medicine.gstRate)) ? Number(medicine.gstRate) : null,
        mrp: typeof medicine.mrp === 'number' && medicine.mrp > 0 ? medicine.mrp : null,
        discountPercent: typeof medicine.discountPercent === 'number' && medicine.discountPercent >= 0 ? medicine.discountPercent : null,
        discountAmount: typeof medicine.discountAmount === 'number' && medicine.discountAmount >= 0 ? medicine.discountAmount : null,
        freeQuantity: typeof medicine.freeQuantity === 'number' && medicine.freeQuantity >= 0 ? Math.floor(medicine.freeQuantity) : null
      })).filter((m: any) => m.medicineName && m.medicineName.trim()) : []
    }

    // Calculate confidence score (Simplified logic)
    let confidence = 0.7
    if (cleanedData.invoiceInfo.supplierName) confidence += 0.1
    if (cleanedData.medicines.length > 0) confidence += 0.1

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
}, 'opd', 'parse-pharmacy-invoice'))
