import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
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
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    const { organization_id, month, year } = await req.json()

    if (!organization_id || !month || !year) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: organization_id, month, year' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check if payroll period already exists
    let { data: period, error: periodError } = await sb
      .from('payroll_periods')
      .select('*')
      .eq('organization_id', organization_id)
      .eq('month', month)
      .eq('year', year)
      .single()

    // Create period if it doesn't exist
    if (!period && periodError?.code === 'PGRST116') { // Not found
      const { data: newPeriod, error: createError } = await sb
        .from('payroll_periods')
        .insert({
          organization_id,
          month,
          year,
          status: 'draft'
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating period:', createError)
        return new Response(
          JSON.stringify({ error: 'Failed to create payroll period' }),
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }

      period = newPeriod
    } else if (periodError) {
      console.error('Error fetching period:', periodError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch payroll period' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    return new Response(
      JSON.stringify(period),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
}, 'workforce', 'payroll-period-bootstrap'))