import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import {
  computeLeaveBalances,
  findLeaveType,
  formatBalance,
  getLeaveYear,
  leaveDaysForRequest,
  parseLeavePolicy,
  parseLeaveTaskDescription
} from '../_shared/leavePolicy.ts';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestLeaveInput {
  userId: string;           // Employee requesting leave
  organizationId: string;
  leaveType: 'full_day' | 'half_day' | 'early_departure';
  leaveCategory?: string;   // SL / CL / ... (code or name, case-insensitive). Defaults to the org's first type.
  startDate: string;        // YYYY-MM-DD format
  endDate?: string;         // YYYY-MM-DD format (optional)
  reason: string;
  isEmergency?: boolean;
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Request Leave ===');

    // Verify service role key (for DigitalOcean bot)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header');
    }

    const providedKey = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
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
    const requestBody: RequestLeaveInput = await req.json();
    const { 
      userId, 
      organizationId, 
      leaveType = 'full_day',
      leaveCategory,
      startDate,
      endDate,
      reason,
      isEmergency = false
    } = requestBody;

    console.log('Request params:', { userId, organizationId, leaveType, leaveCategory, startDate, reason });

    // Validate required fields
    if (!userId) throw new Error('userId is required');
    if (!organizationId) throw new Error('organizationId is required');
    if (!startDate) throw new Error('startDate is required (YYYY-MM-DD format)');
    if (!reason || reason.trim().length === 0) throw new Error('reason is required');

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
      throw new Error('startDate must be in YYYY-MM-DD format');
    }
    if (endDate && !dateRegex.test(endDate)) {
      throw new Error('endDate must be in YYYY-MM-DD format');
    }

    // Verify user exists and belongs to organization
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, department, organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      throw new Error('User not found');
    }

    if (userData.organization_id !== organizationId) {
      throw new Error('User does not belong to this organization');
    }

    console.log('User verified:', userData.name);

    // Resolve the leave category against the organisation's policy
    const { data: orgData } = await supabaseAdmin
      .from('organizations')
      .select('leave_policy')
      .eq('id', organizationId)
      .maybeSingle();

    const policy = parseLeavePolicy(orgData?.leave_policy);
    const category = leaveCategory ? findLeaveType(policy, leaveCategory) : policy.types[0];
    if (!category) {
      const allowed = policy.types.map(t => `${t.code} (${t.name})`).join(', ');
      throw new Error(`Unknown leave category "${leaveCategory}". Allowed: ${allowed}`);
    }

    // Current balance for that category, derived from this user's existing
    // leave-request tasks in the current leave year.
    const { data: existingTasks } = await supabaseAdmin
      .from('tasks')
      .select('description, status')
      .eq('created_by', userId)
      .eq('type', 'personalTask')
      .ilike('description', '%LEAVE REQUEST DETAILS%');

    const leaveYear = getLeaveYear(policy);
    const balances = computeLeaveBalances(
      policy,
      (existingTasks || []).map(t => parseLeaveTaskDescription(t.description || '', t.status)),
      leaveYear
    );
    const balance = balances.find(b => b.code === category.code)!;
    const requestedDays = leaveDaysForRequest({ leave_type: leaveType, start_date: startDate, end_date: endDate });
    const exceedsQuota = balance.annual_quota > 0 && requestedDays > balance.remaining;

    console.log('Leave category:', category.code, 'balance:', formatBalance(balance), 'requested:', requestedDays);

    // Find admin for this organization
    const { data: adminData, error: adminError } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .eq('organization_id', organizationId)
      .in('role', ['admin', 'superadmin'])
      .limit(1);

    if (adminError || !adminData || adminData.length === 0) {
      throw new Error('No admin found for your organization');
    }

    const adminId = adminData[0].id;
    const adminName = adminData[0].name;
    console.log('Admin found:', adminName);

    // Check if it's a post facto request
    const requestDate = new Date(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPostFacto = requestDate < today;

    // Format leave type for display
    const leaveTypeDisplay = leaveType.replace('_', ' ').toUpperCase();

    // Create leave request task (assigned to admin for approval)
    const taskTitle = `Leave Request: ${userData.name} - ${category.code} ${leaveTypeDisplay}${isPostFacto ? ' (Post Facto)' : ''}`;

    const taskDescription = `LEAVE REQUEST DETAILS:
Employee: ${userData.name}
Department: ${userData.department || 'Not specified'}
Leave Type: ${leaveTypeDisplay}
Leave Category: ${category.code}
Start Date: ${startDate}${endDate ? `\nEnd Date: ${endDate}` : ''}
Reason: ${reason}
Emergency: ${isEmergency ? 'YES' : 'NO'}
Balance At Request: ${category.code} ${formatBalance(balance)}${exceedsQuota ? ' (EXCEEDS QUOTA)' : ''}
${isPostFacto ? '\n⚠️ POST FACTO REQUEST: This leave has already been taken' : ''}
Submitted via: WhatsApp

Please review and approve/reject this leave request.`;

    const { data: taskResult, error: taskError } = await supabaseAdmin
      .from('tasks')
      .insert([{
        title: taskTitle,
        description: taskDescription,
        assigned_to: adminId,
        created_by: userId,
        type: 'personalTask',
        priority: isEmergency ? 'critical' : isPostFacto ? 'moderate' : 'lessImportant',
        status: 'pending',
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        organization_id: organizationId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id, title, status, created_at')
      .single();

    if (taskError) {
      console.error('Task creation error:', taskError);
      throw new Error(`Failed to create leave request: ${taskError.message}`);
    }

    console.log('Leave request created:', taskResult.id);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          leaveRequest: {
            id: taskResult.id,
            employeeName: userData.name,
            leaveType: leaveTypeDisplay,
            leaveCategory: category.code,
            leaveCategoryName: category.name,
            requestedDays,
            balance: {
              leaveYear: leaveYear.label,
              annualQuota: balance.annual_quota,
              used: balance.used,
              pending: balance.pending,
              remainingBeforeThisRequest: balance.remaining,
              exceedsQuota
            },
            startDate,
            endDate: endDate || null,
            reason,
            isPostFacto,
            isEmergency,
            status: 'pending',
            assignedToAdmin: adminName,
            createdAt: taskResult.created_at
          }
        },
        message: (isPostFacto
          ? `Post-facto leave request submitted. ${adminName} will review it soon.`
          : `Leave request submitted successfully. ${adminName} will review and respond within 24 hours.`)
          + ` ${category.code} balance: ${formatBalance(balance)}.`
          + (exceedsQuota ? ` Note: this request exceeds your ${category.code} quota, so it needs special approval.` : '')
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-request-leave function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('not found') ? 404 :
               error.message.includes('required') || error.message.includes('format') ? 400 : 500,
      }
    );
  }
}, 'workforce', 'whatsapp-request-leave'));
