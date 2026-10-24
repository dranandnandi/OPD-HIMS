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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseKey)
    
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

    // Get payroll period data using service role
    const { data: periodData, error: periodError } = await supabase
      .from('payroll_periods')
      .select('*')
      .eq('organization_id', organization_id)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle()

    if (periodError) {
      console.error('Period query error:', periodError)
      return new Response(
        JSON.stringify({ error: `Failed to fetch payroll period: ${periodError.message}` }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // If no period exists, create a default one
    const period = periodData || {
      id: `temp-${organization_id}-${month}-${year}`,
      organization_id,
      month,
      year,
      status: 'draft',
      lock_at: null,
      created_by: null,
      created_at: new Date().toISOString()
    }

    return new Response(
      JSON.stringify({ period }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
}, 'workforce', 'payroll-period-fetch'))