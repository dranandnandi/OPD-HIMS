import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

/**
 * Identify a medicine from a photo of its pack / strip.
 *
 * Returns what is printed: brand, generic composition, strength, form,
 * manufacturer, pack size, MRP, batch, expiry, barcode digits. Matching
 * against the clinic's own master and finding substitutes happens in the app,
 * which knows the stock.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64 } = await req.json()
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return json({ error: 'imageBase64 is required' }, 400)
    }

    const apiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!apiKey) {
      return json({ error: 'Google API key not configured' }, 500)
    }

    const mimeType = imageBase64.startsWith('data:') ? imageBase64.split(';')[0].split(':')[1] : 'image/jpeg'
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '')

    const prompt = `You are a pharmacist's assistant for an Indian pharmacy. Look at this photo of a medicine pack, strip, bottle or label and read what is printed on it.

Return ONLY a JSON object with this exact schema:
{
  "brandName": "string|null (the trade name as printed, e.g. 'Dolo 650')",
  "genericName": "string|null (the composition / molecule(s) as printed, e.g. 'Paracetamol'; for combinations join with ' + ', e.g. 'Amoxicillin + Clavulanic Acid')",
  "strength": "string|null (e.g. '650 mg', '500 mg + 125 mg', '5 mg/5 ml')",
  "dosageForm": "tablet|capsule|syrup|injection|cream|drops|inhaler|powder|other|null",
  "manufacturer": "string|null (marketed by / manufactured by)",
  "packSize": "string|null (e.g. '15 tablets', '100 ml')",
  "mrp": "number|null (printed MRP in rupees, number only)",
  "batchNumber": "string|null",
  "expiryDate": "YYYY-MM-DD|null (if only MM/YY is printed use the last day of that month)",
  "barcode": "string|null (the digits under the barcode, usually 13 digits, if legible)",
  "scheduleH": "boolean|null (true if 'Schedule H' / 'Schedule H1' / 'Rx' warning is printed)",
  "confidence": "number between 0 and 1",
  "notes": "string|null (anything unclear or worth telling the pharmacist)"
}

Rules:
- Read, do not guess. If a field is not legible, use null.
- genericName must be the molecule name(s), never the brand.
- Keep strength units exactly as printed.
- Return only the JSON.`

    const geminiResponse = await runtimeFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: cleanBase64 } }
            ]
          }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
        })
      }
    )

    const geminiData = await geminiResponse.json()
    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${geminiData.error?.message || geminiResponse.statusText}`)
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('No content generated')

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('Model returned non-JSON output')
    }

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const forms = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'powder', 'other']
    const form = str(parsed.dosageForm)?.toLowerCase() ?? null

    const result = {
      brandName: str(parsed.brandName),
      genericName: str(parsed.genericName),
      strength: str(parsed.strength),
      dosageForm: form && forms.includes(form) ? form : (form ? 'other' : null),
      manufacturer: str(parsed.manufacturer),
      packSize: str(parsed.packSize),
      mrp: num(parsed.mrp),
      batchNumber: str(parsed.batchNumber),
      expiryDate: str(parsed.expiryDate),
      barcode: str(parsed.barcode)?.replace(/\D/g, '') || null,
      scheduleH: typeof parsed.scheduleH === 'boolean' ? parsed.scheduleH : null,
      confidence: Math.max(0, Math.min(1, num(parsed.confidence) ?? 0.6)),
      notes: str(parsed.notes)
    }

    return json({ success: true, medicine: result })
  } catch (error) {
    return json({ error: 'Failed to identify medicine', details: error instanceof Error ? error.message : String(error) }, 500)
  }
}, 'opd', 'identify-medicine'))
