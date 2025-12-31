// Edge Function: supabase/functions/generate-pdf-from-html/index.ts
// This is a COMPLETE example showing how to handle printVersion flag

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { type, data, printVersion } = await req.json()

        console.log(`Generating ${printVersion ? 'PRINT' : 'DISPLAY'} PDF for ${type}`)

        // Your existing HTML generation logic
        const generatedHTML = generateHTMLFromData(type, data, printVersion)

        // PDF Options based on version type
        const pdfOptions = printVersion ? {
            // PRINT VERSION - Grayscale, no header/footer, letterhead margins
            margins: "180px 20px 150px 20px",  // Top, Right, Bottom, Left
            headerHeight: "0px",
            footerHeight: "0px",
            scale: 1.0,
            displayHeaderFooter: false,
            paperSize: "A4",
            mediaType: "print",
            printBackground: false,  // No background colors/images
            header: "",
            footer: ""
        } : {
            // DISPLAY VERSION - Full color with header/footer
            margins: "20px",
            headerHeight: "120px",
            footerHeight: "80px",
            scale: 1.0,
            displayHeaderFooter: true,
            paperSize: "A4",
            mediaType: "print",
            printBackground: true,
            header: data.clinicSettings.pdfHeaderUrl ?
                `<div style="text-align: center;"><img src="${data.clinicSettings.pdfHeaderUrl}" style="max-height: 100px;" /></div>` :
                "",
            footer: data.clinicSettings.pdfFooterUrl ?
                `<div style="text-align: center;"><img src="${data.clinicSettings.pdfFooterUrl}" style="max-height: 60px;" /></div>` :
                ""
        }

        // Wrap HTML with grayscale filter for print version
        const finalHTML = printVersion
            ? `<!DOCTYPE html>
         <html>
         <head>
           <meta charset="UTF-8">
           <style>
             /* Force grayscale for print version */
             html, body {
               filter: grayscale(100%);
               -webkit-filter: grayscale(100%);
             }
             body, p, div, span {
               color: #000 !important;
             }
             /* Hide header/footer images in print version */
             .pdf-header, .pdf-footer {
               display: none !important;
             }
             /* Ensure proper spacing for letterhead */
             body {
               padding-top: 0;
               padding-bottom: 0;
             }
           </style>
         </head>
         <body>${generatedHTML}</body>
         </html>`
            : generatedHTML

        // Call your PDF generation API
        const PDF_API_URL = Deno.env.get("PDF_API_URL") || "YOUR_PDF_API_URL"
        const API_KEY = Deno.env.get("PDF_API_KEY") || "YOUR_API_KEY"

        const pdfResponse = await fetch(PDF_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({
                name: printVersion
                    ? `Print_${type}_${Date.now()}.pdf`
                    : `${type}_${Date.now()}.pdf`,
                html: finalHTML,
                async: true,
                ...pdfOptions
            })
        })

        if (!pdfResponse.ok) {
            throw new Error(`PDF API failed: ${pdfResponse.statusText}`)
        }

        const pdfResult = await pdfResponse.json()

        // Upload to Supabase Storage
        const fileName = printVersion
            ? `${type}s/print_${Date.now()}.pdf`
            : `${type}s/${Date.now()}.pdf`

        // ... your existing upload logic ...

        return new Response(
            JSON.stringify({ url: uploadedPdfUrl }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('PDF generation error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})

// Helper function to generate HTML (modify your existing function)
function generateHTMLFromData(type: string, data: any, printVersion: boolean): string {
    // Your existing HTML generation logic
    // You can conditionally hide/show elements based on printVersion

    if (printVersion) {
        // Remove header/footer images
        // Simplify colors to grayscale-friendly
        // Adjust spacing for letterhead
    }

    return `<div>Your HTML content here</div>`
}
