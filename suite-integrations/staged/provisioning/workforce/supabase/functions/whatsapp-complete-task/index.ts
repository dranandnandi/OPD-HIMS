import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
// Supabase Edge Function: whatsapp-complete-task
// Marks a task as completed

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { userId, organizationId, taskId, searchTerm } = await req.json()

    // Validate
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
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)

      if (error || !data || data.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: `No pending task found matching "${searchTerm}"` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }
      task = data[0]
    }

    // Check permission - user must be assignee or creator
    if (task.assigned_to !== userId && task.created_by !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'You can only complete tasks assigned to you or created by you' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    // Update task status to completed
    const { data: updatedTask, error: updateError } = await supabaseClient
      .from('tasks')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to complete task' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Task "${task.title}" marked as completed`,
        task: {
          id: updatedTask.id,
          title: updatedTask.title,
          status: updatedTask.status,
          completedAt: updatedTask.completed_at
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
}, 'workforce', 'whatsapp-complete-task'))
