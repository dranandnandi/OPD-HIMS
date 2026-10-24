import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateRecurringTaskRequest {
  userId: string;
  organizationId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  priority?: 'high' | 'medium' | 'low';
  type?: string;
  recurrenceFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | '6monthly' | 'yearly';
  startDate?: string;  // YYYY-MM-DD, defaults to today
  endDate?: string;    // YYYY-MM-DD, optional
  numberOfOccurrences?: number;  // optional, alternative to endDate
  completionWithinHours?: number;
  completionWithinDays?: number;
}

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Create Recurring Task Request ===');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header');
    }

    const providedKey = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (providedKey !== serviceRoleKey) {
      throw new Error('Unauthorized: Invalid service role key');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const requestBody: CreateRecurringTaskRequest = await req.json();
    const { 
      userId, 
      organizationId, 
      title, 
      description, 
      assigneeId, 
      priority,
      type,
      recurrenceFrequency,
      startDate,
      endDate,
      numberOfOccurrences,
      completionWithinHours,
      completionWithinDays
    } = requestBody;

    console.log('Request params:', { userId, organizationId, title, recurrenceFrequency, assigneeId });

    // Validate required fields
    if (!userId) throw new Error('userId is required');
    if (!organizationId) throw new Error('organizationId is required');
    if (!title || title.trim().length === 0) throw new Error('title is required');
    if (!recurrenceFrequency) throw new Error('recurrenceFrequency is required');

    // Verify organization exists
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !orgData) {
      console.error('Organization query error:', orgError);
      throw new Error('Organization not found');
    }

    console.log('Organization verified:', orgData.name);

    // Verify user exists
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) throw new Error('User not found');
    if (userData.organization_id !== organizationId) throw new Error('User does not belong to this organization');

    console.log('User verified:', userData.name);

    // Verify assignee if provided
    let assigneeName: string | null = null;
    if (assigneeId) {
      const { data: assigneeData, error: assigneeError } = await supabaseAdmin
        .from('users')
        .select('id, name, organization_id')
        .eq('id', assigneeId)
        .single();

      if (assigneeError || !assigneeData) throw new Error('Assignee not found');
      if (assigneeData.organization_id !== organizationId) throw new Error('Assignee does not belong to this organization');
      assigneeName = assigneeData.name;
    }

    // Map priority
    const priorityMap: Record<string, string> = {
      'high': 'critical',
      'medium': 'moderate',
      'low': 'lessImportant'
    };
    const taskPriority = priorityMap[priority || 'medium'] || 'moderate';

    // Map type - recurring only supports subset
    const typeMap: Record<string, string> = {
      'Advisory': 'quickAdvisory',
      'Follow-up': 'followUp',
      'Personal': 'personalTask',
      'Round': 'clinicalRound'
    };
    const taskType = typeMap[type || 'Personal'] || 'personalTask';

    // Validate recurrence frequency
    const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', '6monthly', 'yearly'];
    if (!validFrequencies.includes(recurrenceFrequency)) {
      throw new Error(`Invalid recurrence frequency. Must be: ${validFrequencies.join(', ')}`);
    }

    // Parse start date (default to today)
    const parsedStartDate = startDate ? new Date(startDate) : new Date();
    parsedStartDate.setHours(9, 0, 0, 0); // Default to 9 AM

    // Parse end date if provided
    let parsedEndDate: Date | null = null;
    if (endDate) {
      parsedEndDate = new Date(endDate);
      parsedEndDate.setHours(23, 59, 59, 999);
    }

    // Create recurring task template
    const templateData = {
      organization_id: organizationId,
      created_by: userId,
      assigned_to: assigneeId || userId, // Self-assign if no assignee
      title: title.trim(),
      description: description?.trim() || '',
      type: taskType,
      priority: taskPriority,
      recurrence_frequency: recurrenceFrequency,
      start_date: parsedStartDate.toISOString(),
      end_date: parsedEndDate?.toISOString() || null,
      number_of_occurrences: numberOfOccurrences || null,
      completion_within_hours: completionWithinHours || null,
      completion_within_days: completionWithinDays || 1,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating recurring template:', templateData);

    const { data: templateResult, error: templateError } = await supabaseAdmin
      .from('recurring_task_templates')
      .insert(templateData)
      .select()
      .single();

    if (templateError) {
      console.error('Template creation error:', templateError);
      throw new Error(`Failed to create recurring task: ${templateError.message}`);
    }

    console.log('Recurring task template created:', templateResult.id);

    // Also create the first task instance immediately
    const firstTaskData = {
      organization_id: organizationId,
      created_by: userId,
      assigned_to: assigneeId || userId,
      title: title.trim(),
      description: description?.trim() || '',
      type: taskType,
      priority: taskPriority,
      status: 'Pending',
      due_date: parsedStartDate.toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: firstTask, error: firstTaskError } = await supabaseAdmin
      .from('tasks')
      .insert(firstTaskData)
      .select()
      .single();

    if (firstTaskError) {
      console.warn('First task creation warning:', firstTaskError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          template: {
            id: templateResult.id,
            title: templateResult.title,
            recurrence_frequency: templateResult.recurrence_frequency,
            assigned_to_name: assigneeName || userData.name,
            start_date: templateResult.start_date,
            end_date: templateResult.end_date
          },
          first_task: firstTask ? {
            id: firstTask.id,
            title: firstTask.title,
            due_date: firstTask.due_date
          } : null,
          message: `Recurring ${recurrenceFrequency} task "${title}" created successfully!`
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-create-recurring-task:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 : 
               error.message.includes('not found') ? 404 : 400
      }
    );
  }
}, 'workforce', 'whatsapp-create-recurring-task'));
