import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64, fileType } = await req.json()
    
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'Image data is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Clean the base64 string - handle both image and PDF formats
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '')

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

    let extractedText = ''

    // Handle PDF files differently from images
    if (fileType === 'application/pdf' || imageBase64.startsWith('data:application/pdf')) {
      // For PDFs, use Document AI API which is better suited for document processing
      const documentRequest = {
        rawDocument: {
          content: cleanBase64,
          mimeType: 'application/pdf'
        }
      }

      const documentResponse = await fetch(`https://documentai.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us/processors/YOUR_PROCESSOR_ID:process?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(documentRequest)
      })

      if (!documentResponse.ok) {
        // Fallback to Vision API for PDFs if Document AI is not available
        const visionRequest = {
          requests: [{
            image: {
              content: cleanBase64
            },
            features: [{
              type: 'DOCUMENT_TEXT_DETECTION',
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

        extractedText = visionData.responses?.[0]?.fullTextAnnotation?.text || ''
      } else {
        const documentData = await documentResponse.json()
        extractedText = documentData.document?.text || ''
      }
    } else {
      // Handle image files with Vision API
      const visionRequest = {
        requests: [{
          image: {
            content: cleanBase64
          },
          features: [{
            type: 'TEXT_DETECTION',
            maxResults: 1
          }]
        }]
      }

      // Call Vision API using API key
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

      // Extract text from Vision API response
      extractedText = visionData.responses?.[0]?.fullTextAnnotation?.text || ''
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        extractedText: extractedText 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process document with Vision API',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})