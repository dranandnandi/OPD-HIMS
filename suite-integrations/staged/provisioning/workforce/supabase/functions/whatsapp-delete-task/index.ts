import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteTaskRequest {
  userId: string;
  organizationId: string;
  taskId?: string;       // Delete by ID
  taskTitle?: string;    // Delete by title (matches most recent)
}

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Delete Task Request ===');

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

    const requestBody: DeleteTaskRequest = await req.json();
    const { userId, organizationId, taskId, taskTitle } = requestBody;

    console.log('Request params:', { userId, organizationId, taskId, taskTitle });

    // Validate required fields
    if (!userId) throw new Error('userId is required');
    if (!organizationId) throw new Error('organizationId is required');
    if (!taskId && !taskTitle) throw new Error('Either taskId or taskTitle is required');

    // Verify user exists and belongs to organization
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, organization_id, is_active')
      .eq('id', userId)
      .single();

    if (userError || !userData) throw new Error('User not found');
    if (userData.is_active === false) throw new Error('User is inactive');
    if (userData.organization_id !== organizationId) throw new Error('User does not belong to this organization');

    console.log('User verified:', userData.name);

    let taskToDelete: any = null;

    // Find task by ID or title
    if (taskId) {
      const { data: task, error: taskError } = await supabaseAdmin
        .from('tasks')
        .select('id, title, status, created_by, assigned_to, organization_id')
        .eq('id', taskId)
        .eq('organization_id', organizationId)
        .single();

      if (taskError || !task) {
        throw new Error(`Task with ID "${taskId}" not found`);
      }
      taskToDelete = task;
    } else if (taskTitle) {
      // Find most recent task with matching title (case-insensitive partial match)
      const { data: tasks, error: tasksError } = await supabaseAdmin
        .from('tasks')
        .select('id, title, status, created_by, assigned_to, organization_id, created_at')
        .eq('organization_id', organizationId)
        .ilike('title', `%${taskTitle}%`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (tasksError || !tasks || tasks.length === 0) {
        throw new Error(`No task found matching "${taskTitle}"`);
      }
      taskToDelete = tasks[0];
    }

    // Check permissions: user can delete if they created it or it's assigned to them
    const canDelete = 
      taskToDelete.created_by === userId || 
      taskToDelete.assigned_to === userId;

    if (!canDelete) {
      throw new Error('You can only delete tasks you created or tasks assigned to you');
    }

    console.log('Task found:', taskToDelete.title, 'Status:', taskToDelete.status);

    // Delete the task
    const { error: deleteError } = await supabaseAdmin
      .from('tasks')
      .delete()
      .eq('id', taskToDelete.id);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      throw new Error(`Failed to delete task: ${deleteError.message}`);
    }

    console.log('Task deleted successfully:', taskToDelete.id);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          deleted_task: {
            id: taskToDelete.id,
            title: taskToDelete.title,
            status: taskToDelete.status
          },
          message: `Task "${taskToDelete.title}" has been deleted successfully.`
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-delete-task:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 : 
               error.message.includes('not found') ? 404 : 400
      }
    );
  }
}, 'workforce', 'whatsapp-delete-task'));
