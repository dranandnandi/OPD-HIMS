import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

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
    const { phoneNumber, message, clinicId } = await req.json()
    
    if (!phoneNumber || !message || !clinicId) {
      return new Response(
        JSON.stringify({ error: 'phoneNumber, message, and clinicId are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get the Blueticks API key from clinic settings
    const { data: clinicSettings, error: clinicError } = await supabase
      .from('clinic_settings')
      .select('blueticks_api_key')
      .eq('id', clinicId)
      .single()

    if (clinicError || !clinicSettings) {
      throw new Error('Failed to fetch clinic settings')
    }

    if (!clinicSettings.blueticks_api_key) {
      throw new Error('Blueticks API key not configured for this clinic')
    }

    // Format phone number for API (assuming Indian numbers)
    let formattedPhone = phoneNumber.replace(/\D/g, '')
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = `91${formattedPhone}`
    }
    
    // Send message via Blueticks API
    const response = await fetch('https://api.blueticks.co/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: clinicSettings.blueticks_api_key,
        to: `+${formattedPhone}`,
        message: message
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Blueticks API Error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    return new Response(
      JSON.stringify({ 
        success: true,
        result: result,
        message: 'Message sent successfully via Blueticks'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to send message via Blueticks',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})