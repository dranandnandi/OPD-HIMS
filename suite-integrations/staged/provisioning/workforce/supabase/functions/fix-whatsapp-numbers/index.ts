import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
// Fix WhatsApp numbers in notifications
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    if (req.method === 'POST') {
      const { action } = await req.json()

      if (action === 'check_user') {
        const { user_id } = await req.json()
        
        // Get user details
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id, name, whatsapp_number')
          .eq('id', user_id)
          .single()

        if (userError) {
          console.error('User error:', userError)
          return new Response(
            JSON.stringify({ error: 'User not found', details: userError }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
          )
        }

        return new Response(
          JSON.stringify({ user }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (action === 'fix_notifications') {
        // Update notifications with missing WhatsApp numbers
        const { data, error } = await supabase.rpc('update_missing_whatsapp_numbers')

        if (error) {
          console.error('Error fixing notifications:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to fix notifications', details: error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          )
        }

        return new Response(
          JSON.stringify({ message: 'Notifications fixed', updated_count: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (action === 'check_notifications') {
        // Get notifications with missing WhatsApp numbers
        const { data: notifications, error } = await supabase
          .from('notifications')
          .select(`
            id,
            user_id,
            task_id,
            type,
            whatsapp_number,
            created_at,
            users!inner(name, whatsapp_number)
          `)
          .is('whatsapp_number', null)
          .order('created_at', { ascending: false })
          .limit(10)

        if (error) {
          console.error('Error getting notifications:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to get notifications', details: error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          )
        }

        return new Response(
          JSON.stringify({ notifications }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ error: 'Invalid request' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}, 'workforce', 'fix-whatsapp-numbers'))
