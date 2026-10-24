import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateTaskRequest {
  userId: string;                // Who creates the task (from WhatsApp)
  organizationId: string;
  title: string;
  description?: string;
  assigneeId?: string;           // null = unassigned, userId = self-assigned
  priority?: 'high' | 'medium' | 'low';
  dueDate?: string;              // ISO date string
  type?: string;                 // Task type
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Create Task Request ===');

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
    const requestBody: CreateTaskRequest = await req.json();
    const { 
      userId, 
      organizationId, 
      title, 
      description, 
      assigneeId, 
      priority, 
      dueDate, 
      type 
    } = requestBody;

    console.log('Request params:', { 
      userId, 
      organizationId, 
      title, 
      assigneeId, 
      priority, 
      dueDate 
    });

    // Validate required fields
    if (!userId) {
      throw new Error('userId is required');
    }
    if (!organizationId) {
      throw new Error('organizationId is required');
    }
    if (!title || title.trim().length === 0) {
      throw new Error('title is required');
    }

    // Verify organization exists
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();

    if (orgError) {
      console.error('Organization query error:', orgError);
      throw new Error(`Organization not found: ${orgError.message}`);
    }
    
    if (!orgData) {
      throw new Error('Organization not found: no data returned');
    }

    console.log('Organization verified:', orgData.name);

    // Verify user exists and belongs to organization
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, organization_id, role, is_active')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      throw new Error('User not found');
    }

    if (userData.is_active === false) {
      throw new Error('User is inactive');
    }

    if (userData.organization_id !== organizationId) {
      throw new Error('User does not belong to this organization');
    }

    console.log('User verified:', userData.name);

    // If assigneeId provided, verify assignee exists and belongs to same org
    let assigneeName: string | null = null;
    if (assigneeId) {
      const { data: assigneeData, error: assigneeError } = await supabaseAdmin
        .from('users')
        .select('id, name, organization_id, is_active')
        .eq('id', assigneeId)
        .single();

      if (assigneeError || !assigneeData) {
        throw new Error('Assignee not found');
      }

      if (assigneeData.is_active === false) {
        throw new Error('Assignee is inactive');
      }

      if (assigneeData.organization_id !== organizationId) {
        throw new Error('Assignee does not belong to this organization');
      }

      assigneeName = assigneeData.name;
      console.log('Assignee verified:', assigneeName);
    }

    // Map AI-friendly type to database type
    const typeMap: Record<string, string> = {
      'Advisory': 'quickAdvisory',
      'Reporting': 'regularTask',
      'Follow-up': 'followUp',
      'Collection': 'regularTask',
      'Registration': 'regularTask',
      'Discharge': 'regularTask',
      'Investigation': 'auditTask',
      'Personal': 'personalTask',
      'Task': 'regularTask'
    };
    const taskType = typeMap[type || 'Advisory'] || 'regularTask';

    // Map AI-friendly priority to database priority
    const priorityMap: Record<string, string> = {
      'high': 'critical',
      'medium': 'moderate',
      'low': 'lessImportant'
    };
    const taskPriority = priorityMap[priority || 'medium'] || 'moderate';

    // Parse due date
    let parsedDueDate: string | null = null;
    if (dueDate) {
      try {
        const date = new Date(dueDate);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid date format');
        }
        parsedDueDate = date.toISOString();
      } catch (e) {
        throw new Error('Invalid dueDate format. Use ISO date string (YYYY-MM-DD)');
      }
    }

    // Create task
    const taskData = {
      title: title.trim(),
      description: description?.trim() || '',
      type: taskType,
      priority: taskPriority,
      status: 'Pending',
      created_by: userId,
      assigned_to: assigneeId || null,
      organization_id: organizationId,
      due_date: parsedDueDate,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating task with data:', taskData);

    const { data: taskResult, error: taskError } = await supabaseAdmin
      .from('tasks')
      .insert([taskData])
      .select('*')
      .single();

    if (taskError) {
      console.error('Task creation error:', taskError);
      throw new Error(`Failed to create task: ${taskError.message}`);
    }

    console.log('Task created successfully:', taskResult.id);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          task: {
            id: taskResult.id,
            title: taskResult.title,
            description: taskResult.description,
            type: taskResult.type,
            priority: taskResult.priority,
            status: taskResult.status,
            created_by_name: userData.name,
            assigned_to_name: assigneeName,
            due_date: taskResult.due_date,
            created_at: taskResult.created_at
          }
        },
        message: `Task created successfully${assigneeName ? ` and assigned to ${assigneeName}` : ''}`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-create-task function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('not found') || error.message.includes('does not belong') ? 404 :
               error.message.includes('required') || error.message.includes('Invalid') ? 400 : 500,
      }
    );
  }
}, 'workforce', 'whatsapp-create-task'));
