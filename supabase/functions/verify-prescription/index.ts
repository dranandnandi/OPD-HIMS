import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
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
    const { id } = await req.json()

    if (!id) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Missing visit id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Query visit with patient and doctor info
    const { data: visit, error } = await supabase
      .from('visits')
      .select(`
        id,
        date,
        pdf_url,
        print_pdf_url,
        compact_print_pdf_url,
        patients!visits_patient_id_fkey (
          name,
          age,
          gender
        ),
        profiles!visits_doctor_id_fkey (
          name,
          specialization,
          registrationNo:registration_no
        ),
        clinics:clinic_settings!visits_clinic_id_fkey (
          clinicName:clinic_name
        )
      `)
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('DB error:', error)
      return new Response(
        JSON.stringify({ status: 'error', message: 'Database error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!visit) {
      return new Response(
        JSON.stringify({ status: 'not_found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Return safe public fields only — no diagnosis, no medications
    return new Response(
      JSON.stringify({
        status: 'verified',
        data: {
          visitId: visit.id,
          date: visit.date,
          patientName: visit.patients?.name ?? '',
          patientAge: visit.patients?.age ?? null,
          patientGender: visit.patients?.gender ?? '',
          doctorName: visit.profiles?.name ?? '',
          doctorSpecialization: visit.profiles?.specialization ?? '',
          registrationNo: visit.profiles?.registrationNo ?? '',
          clinicName: visit.clinics?.clinicName ?? '',
          pdfUrl: visit.pdf_url ?? visit.print_pdf_url ?? null,
          verifiedAt: new Date().toISOString(),
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('verify-prescription error:', err)
    return new Response(
      JSON.stringify({ status: 'error', message: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
