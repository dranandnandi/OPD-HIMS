import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GetAttendanceRequest {
  organizationId: string;
  date?: string;  // Optional, defaults to today (YYYY-MM-DD format)
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Get Attendance Request ===');

    // Verify service role key (for DigitalOcean bot)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header');
    }

    const providedKey = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Verify it's the service role key (not a user JWT)
    if (providedKey !== serviceRoleKey) {
      throw new Error('Unauthorized: Invalid service role key');
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Parse request body
    const requestBody: GetAttendanceRequest = await req.json();
    const { organizationId, date } = requestBody;

    console.log('Request params:', { organizationId, date });

    // Validate required fields
    if (!organizationId) {
      throw new Error('organizationId is required');
    }

    // Use today's date if not provided
    const targetDate = date || new Date().toISOString().split('T')[0];
    console.log('Target date:', targetDate);

    // Verify organization exists
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !orgData) {
      throw new Error('Organization not found');
    }

    console.log('Organization verified:', orgData.name);

    // Get all users in organization
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, whatsapp_number, department, role')
      .eq('organization_id', organizationId)
      .order('name');

    if (usersError) {
      console.error('Users query error:', usersError);
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    const totalEmployees = allUsers?.length || 0;
    console.log(`Total employees in organization: ${totalEmployees}`);

    // Get attendance for the specified date (no FK joins to avoid PGRST200)
    const userIds = allUsers?.map(u => u.id) || [];
    const { data: attendanceData, error: attendanceError } = await supabaseAdmin
      .from('attendance')
      .select('*')
      .eq('date', targetDate)
      .in('user_id', userIds);

    if (attendanceError) {
      console.error('Attendance query error:', attendanceError);
      throw new Error(`Failed to fetch attendance: ${attendanceError.message}`);
    }

    // Fetch shift names for attendance records that have shift_id
    const shiftIds = [...new Set((attendanceData || []).map(r => r.shift_id).filter(Boolean))];
    const shiftMap: Record<string, any> = {};
    if (shiftIds.length > 0) {
      const { data: shifts } = await supabaseAdmin
        .from('shifts')
        .select('id, name, start_time, end_time')
        .in('id', shiftIds);
      if (shifts) {
        for (const s of shifts) {
          shiftMap[s.id] = s;
        }
      }
    }

    console.log(`Found ${attendanceData?.length || 0} attendance records`);

    // Build user lookup map
    const userMap = new Map(
      (allUsers || []).map(u => [u.id, u])
    );

    // Categorize attendance
    const presentUsers: any[] = [];
    const absentUsers: any[] = [];
    const lateUsers: any[] = [];
    const earlyOutUsers: any[] = [];

    // Create a map of users who have attendance records
    const attendanceMap = new Map(
      (attendanceData || []).map(record => [record.user_id, record])
    );

    // Process all users
    for (const user of allUsers || []) {
      const record = attendanceMap.get(user.id);

      if (record && record.punch_in_time) {
        const shift = record.shift_id ? shiftMap[record.shift_id] : null;
        // User is present
        const userInfo = {
          id: user.id,
          name: user.name,
          department: user.department,
          whatsapp_number: user.whatsapp_number,
          punch_in_time: record.punch_in_time,
          punch_out_time: record.punch_out_time,
          total_hours: record.total_hours,
          shift_name: shift?.name || null,
          is_late: record.is_late || false,
          is_early_out: record.is_early_out || false,
          is_regularized: record.is_regularized || false
        };

        presentUsers.push(userInfo);

        // Also add to late/early categories if applicable
        if (record.is_late && !record.is_regularized) {
          lateUsers.push(userInfo);
        }
        if (record.is_early_out && !record.is_regularized) {
          earlyOutUsers.push(userInfo);
        }
      } else {
        // User is absent
        absentUsers.push({
          id: user.id,
          name: user.name,
          department: user.department,
          whatsapp_number: user.whatsapp_number
        });
      }
    }

    // Calculate statistics
    const stats = {
      total_employees: totalEmployees,
      present_count: presentUsers.length,
      absent_count: absentUsers.length,
      late_count: lateUsers.length,
      early_out_count: earlyOutUsers.length,
      attendance_percentage: totalEmployees > 0 
        ? Math.round((presentUsers.length / totalEmployees) * 100) 
        : 0
    };

    console.log('Attendance statistics:', stats);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          organization: {
            id: orgData.id,
            name: orgData.name
          },
          date: targetDate,
          statistics: stats,
          present: presentUsers,
          absent: absentUsers,
          late: lateUsers,
          early_out: earlyOutUsers
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-get-attendance function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('not found') ? 404 :
               error.message.includes('required') ? 400 : 500,
      }
    );
  }
}, 'workforce', 'whatsapp-get-attendance'));
