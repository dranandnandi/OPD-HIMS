import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
// Supabase Edge Function: whatsapp-update-task
// Updates a task's status or fields

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'blocked']
const VALID_PRIORITIES = ['high', 'medium', 'low']

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { userId, organizationId, taskId, searchTerm, status, priority, dueDate } = await req.json()

    // Validate required fields
    if (!userId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'userId and organizationId are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (!taskId && !searchTerm) {
      return new Response(
        JSON.stringify({ success: false, error: 'Either taskId or searchTerm is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const { data: requester, error: requesterError } = await supabaseClient
      .from('users')
      .select('id, organization_id, is_active')
      .eq('id', userId)
      .single()

    if (requesterError || !requester || requester.organization_id !== organizationId || requester.is_active === false) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Validate update fields
    if (status && !VALID_STATUSES.includes(status)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid status. Use: ${VALID_STATUSES.join(', ')}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid priority. Use: ${VALID_PRIORITIES.join(', ')}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    let task = null

    // Find task by ID or search term
    if (taskId) {
      const { data, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('organization_id', organizationId)
        .single()

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: 'Task not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }
      task = data
    } else {
      // Search by title
      const { data, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('organization_id', organizationId)
        .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
        .ilike('title', `%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error || !data || data.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: `No task found matching "${searchTerm}"` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }
      task = data[0]
    }

    // Check permission
    if (task.assigned_to !== userId && task.created_by !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'You can only update tasks assigned to you or created by you' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    // Build update object
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString()
    }

    if (status) {
      updates.status = status
      if (status === 'completed') {
        updates.completed_at = new Date().toISOString()
      }
    }
    if (priority) updates.priority = priority
    if (dueDate) updates.due_date = dueDate

    // Update task
    const { data: updatedTask, error: updateError } = await supabaseClient
      .from('tasks')
      .update(updates)
      .eq('id', task.id)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update task' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Build change description
    const changes = []
    if (status) changes.push(`status → ${status}`)
    if (priority) changes.push(`priority → ${priority}`)
    if (dueDate) changes.push(`due date → ${dueDate}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Task "${task.title}" updated: ${changes.join(', ')}`,
        task: {
          id: updatedTask.id,
          title: updatedTask.title,
          status: updatedTask.status,
          priority: updatedTask.priority,
          dueDate: updatedTask.due_date
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}, 'workforce', 'whatsapp-update-task'))
