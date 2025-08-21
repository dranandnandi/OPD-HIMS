import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔍 [Edge Function] Starting profile fetch...')
    
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header provided')
    }

    // Extract the JWT token
    const token = authHeader.replace('Bearer ', '')
    console.log('🔐 [Edge Function] Token received, length:', token.length)

    // Initialize Supabase client with service role key for database access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify the JWT token and get user info
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    
    if (userError || !user) {
      console.error('❌ [Edge Function] Auth error:', userError)
      throw new Error('Invalid or expired token')
    }

    console.log('👤 [Edge Function] Authenticated user ID:', user.id)

    // Query the profile with all related data
    const { data: dbProfile, error: profileError } = await supabase
      .from('profiles')
      .select(`
        id,
        user_id,
        role_id,
        clinic_id,
        name,
        email,
        phone,
        specialization,
        qualification,
        registration_no,
        role_name,
        permissions,
        consultation_fee,
        follow_up_fee,
        emergency_fee,
        is_active,
        created_at,
        updated_at,
        clinic_settings:clinic_id (
          id,
          clinic_name,
          phone,
          address,
          registration_number,
          created_at,
          updated_at,
          follow_up_fee,
          emergency_fee,
          consultation_fee,
          appointment_duration,
          working_hours,
          currency,
          timezone,
          email,
          website,
          logo_url,
          tax_id
        )
      `)
      .eq('id', user.id)
      .maybeSingle()

    console.log('📦 [Edge Function] Profile query completed')
    console.log('📦 [Edge Function] Profile found:', !!dbProfile)
    console.log('⚠️ [Edge Function] Profile error:', profileError)

    if (profileError) {
      console.error('❌ [Edge Function] Database error:', profileError)
      throw new Error(`Database error: ${profileError.message}`)
    }

    if (!dbProfile) {
      console.warn('⚠️ [Edge Function] No profile found for user ID:', user.id)
      
      // Check if user exists in auth.users but not in profiles table
      console.log('🔍 [Edge Function] Checking auth user details...')
      console.log('👤 [Edge Function] Auth user email:', user.email)
      console.log('👤 [Edge Function] Auth user created_at:', user.created_at)
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Profile not found',
          details: 'User exists in auth but no profile record found',
          userId: user.id,
          userEmail: user.email
        }),
        { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Convert database profile to the expected format
    const profile = {
      id: dbProfile.id,
      userId: dbProfile.user_id,
      roleId: dbProfile.role_id,
      clinicId: dbProfile.clinic_id,
      name: dbProfile.name,
      email: dbProfile.email,
      phone: dbProfile.phone,
      specialization: dbProfile.specialization,
      qualification: dbProfile.qualification,
      registrationNo: dbProfile.registration_no,
      roleName: dbProfile.role_name,
      permissions: dbProfile.permissions,
      consultationFee: dbProfile.consultation_fee,
      followUpFee: dbProfile.follow_up_fee,
      emergencyFee: dbProfile.emergency_fee,
      isActive: dbProfile.is_active,
      createdAt: dbProfile.created_at,
      updatedAt: dbProfile.updated_at,
      clinic: dbProfile.clinic_settings ? {
        id: dbProfile.clinic_settings.id,
        clinicName: dbProfile.clinic_settings.clinic_name,
        address: dbProfile.clinic_settings.address,
        phone: dbProfile.clinic_settings.phone,
        email: dbProfile.clinic_settings.email,
        website: dbProfile.clinic_settings.website,
        logoUrl: dbProfile.clinic_settings.logo_url,
        registrationNumber: dbProfile.clinic_settings.registration_number,
        taxId: dbProfile.clinic_settings.tax_id,
        consultationFee: dbProfile.clinic_settings.consultation_fee,
        followUpFee: dbProfile.clinic_settings.follow_up_fee,
        emergencyFee: dbProfile.clinic_settings.emergency_fee,
        appointmentDuration: dbProfile.clinic_settings.appointment_duration,
        workingHours: dbProfile.clinic_settings.working_hours,
        currency: dbProfile.clinic_settings.currency,
        timezone: dbProfile.clinic_settings.timezone,
        createdAt: dbProfile.clinic_settings.created_at,
        updatedAt: dbProfile.clinic_settings.updated_at,
      } : undefined
    }

    console.log('✅ [Edge Function] Profile successfully fetched and converted')
    console.log('👤 [Edge Function] Profile name:', profile.name)
    console.log('🏥 [Edge Function] Clinic:', profile.clinic?.clinicName || 'No clinic')

    return new Response(
      JSON.stringify({ 
        success: true, 
        profile: profile
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('💥 [Edge Function] Error:', error)
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'Failed to fetch user profile',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})