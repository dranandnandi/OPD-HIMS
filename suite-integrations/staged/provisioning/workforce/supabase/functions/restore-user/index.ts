import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(guardEdge(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(401, { success: false, error: 'Missing authorization header' });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const token = authHeader.slice('Bearer '.length);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse(401, { success: false, error: 'Invalid or expired session' });
    }

    const { data: adminUser, error: adminError } = await supabaseAdmin
      .from('users')
      .select('role, organization_id')
      .eq('auth_id', user.id)
      .single();

    if (adminError || !adminUser) {
      return jsonResponse(404, { success: false, error: 'Admin user record was not found' });
    }

    if (!['admin', 'superadmin'].includes(adminUser.role)) {
      return jsonResponse(403, { success: false, error: 'Only admins can restore users' });
    }

    const { userId } = await req.json();
    if (!userId) {
      return jsonResponse(400, { success: false, error: 'User ID is required' });
    }

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select('auth_id, organization_id, is_active')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      return jsonResponse(404, { success: false, error: 'User was not found' });
    }

    if (targetUser.organization_id !== adminUser.organization_id) {
      return jsonResponse(403, {
        success: false,
        error: 'You can only restore users in your organization',
      });
    }

    if (targetUser.is_active !== false) {
      return jsonResponse(409, { success: false, error: 'This user is already active' });
    }

    if (!targetUser.auth_id) {
      return jsonResponse(409, {
        success: false,
        error: 'This user profile is not linked to a login account',
      });
    }

    const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUser.auth_id,
      { ban_duration: 'none' }
    );

    if (unbanError) {
      console.error('Failed to unban auth user:', unbanError);
      return jsonResponse(400, { success: false, error: unbanError.message });
    }

    const { error: activateError } = await supabaseAdmin
      .from('users')
      .update({
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (activateError) {
      console.error('Failed to reactivate user profile:', activateError);
      await supabaseAdmin.auth.admin.updateUserById(
        targetUser.auth_id,
        { ban_duration: '876600h' }
      );
      return jsonResponse(500, {
        success: false,
        error: `Failed to reactivate user profile: ${activateError.message}`,
      });
    }

    return jsonResponse(200, {
      success: true,
      message: 'User restored successfully',
    });
  } catch (error: any) {
    console.error('Unexpected restore-user error:', error);
    return jsonResponse(500, {
      success: false,
      error: error.message || 'An unexpected error occurred',
    });
  }
}, 'workforce', 'restore-user'));
