import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const imagekitPrivateKey = Deno.env.get('IMAGEKIT_PRIVATE_KEY') ?? ''
        const imagekitPublicKey = Deno.env.get('IMAGEKIT_PUBLIC_KEY') ?? ''
        const imagekitUrlEndpoint = Deno.env.get('IMAGEKIT_URL_ENDPOINT') ?? ''

        if (!imagekitPrivateKey || !imagekitPublicKey || !imagekitUrlEndpoint) {
            throw new Error('ImageKit credentials not configured')
        }

        const supabase = createClient(supabaseUrl, supabaseKey)
        const { assetId, assetType, storagePath } = await req.json()

        console.log(`[ImageKit] Processing asset: ${assetId}, type: ${assetType}`)

        // Download file from Supabase Storage
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('pdf-assets')
            .download(storagePath)

        if (downloadError) {
            throw new Error(`Failed to download file: ${downloadError.message}`)
        }

        // Convert blob to base64
        const arrayBuffer = await fileData.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

        // Upload to ImageKit
        const authString = btoa(`${imagekitPrivateKey}:`)
        const fileName = storagePath.split('/').pop() || 'image.png'

        const formData = new FormData()
        formData.append('file', `data:${fileData.type};base64,${base64}`)
        formData.append('fileName', fileName)
        formData.append('folder', `/clinic-assets/${assetType}`)

        const uploadResponse = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`,
            },
            body: formData
        })

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text()
            throw new Error(`ImageKit upload failed: ${errorText}`)
        }

        const uploadResult = await uploadResponse.json()
        console.log(`[ImageKit] Upload successful: ${uploadResult.fileId}`)

        // Generate single optimized URL based on asset type
        const filePath = uploadResult.filePath
        let optimizedUrl: string

        if (assetType === 'signature') {
            // Signature: Remove background, resize to 200px, auto format
            optimizedUrl = `${imagekitUrlEndpoint}/tr:e-removedotbg,w-200,fo-auto${filePath}`
        } else if (assetType === 'header' || assetType === 'footer') {
            // Header/Footer: Upscale, wide format (1000px), auto format
            optimizedUrl = `${imagekitUrlEndpoint}/tr:e-upscale,w-1000,fo-auto${filePath}`
        } else {
            // Default: Upscale, high quality (1600px), auto format
            optimizedUrl = `${imagekitUrlEndpoint}/tr:e-upscale,w-1600,fo-auto${filePath}`
        }

        console.log(`[ImageKit] Optimized URL: ${optimizedUrl}`)

        // Update database with ImageKit URL
        if (assetType === 'header') {
            const { error } = await supabase
                .from('clinic_settings')
                .update({
                    pdfHeaderUrl: optimizedUrl
                })
                .eq('id', assetId)

            if (error) throw error
        } else if (assetType === 'footer') {
            const { error } = await supabase
                .from('clinic_settings')
                .update({
                    pdfFooterUrl: optimizedUrl
                })
                .eq('id', assetId)

            if (error) throw error
        } else if (assetType === 'signature') {
            const { error } = await supabase
                .from('profiles')
                .update({
                    signatureUrl: optimizedUrl
                })
                .eq('id', assetId)

            if (error) throw error
        }

        console.log(`[ImageKit] Database updated successfully`)

        return new Response(
            JSON.stringify({
                success: true,
                optimizedUrl
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('[ImageKit] Error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    }
})
