import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteUserRequest {
  userId: string;
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Extract JWT token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify the JWT token and get user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError);
      throw new Error('Unauthorized: Invalid or expired token');
    }

    // Verify the requesting user is an admin
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('users')
      .select('role, organization_id')
      .eq('auth_id', user.id)
      .single();

    if (adminCheckError || !adminUser) {
      throw new Error('User not found in database');
    }

    if (!['admin', 'superadmin'].includes(adminUser.role)) {
      throw new Error('Forbidden: Only admins can delete users');
    }

    // Parse request body
    const requestBody: DeleteUserRequest = await req.json();
    const { userId } = requestBody;

    if (!userId) {
      throw new Error('Missing user ID');
    }

    // Get the user to be deleted
    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from('users')
      .select('auth_id, organization_id')
      .eq('id', userId)
      .single();

    if (targetUserError || !targetUser) {
      throw new Error('User to delete not found');
    }

    // Verify admin is deleting user in their own organization
    if (adminUser.organization_id !== targetUser.organization_id) {
      throw new Error('Forbidden: Cannot delete users in other organizations');
    }

    // Prevent self-deletion
    if (user.id === targetUser.auth_id) {
      throw new Error('Cannot delete your own account');
    }

    console.log('Deactivating user profile:', userId);

    // Step 1: Soft delete — set is_active = false (preserves FK references)
    const { error: deactivateError } = await supabaseAdmin
      .from('users')
      .update({ is_active: false })
      .eq('id', userId);

    if (deactivateError) {
      throw new Error(`Failed to deactivate user profile: ${deactivateError.message}`);
    }

    console.log('User profile deactivated successfully');

    // Step 2: Disable auth login so user can't sign in anymore
    if (targetUser.auth_id) {
      console.log('Disabling auth user:', targetUser.auth_id);
      try {
        const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
          targetUser.auth_id,
          { ban_duration: '876600h' } // ~100 years = effectively permanent
        );
        
        if (banError) {
          console.error('Failed to ban auth user:', banError);
          // Don't throw - profile deactivation succeeded
        } else {
          console.log('Auth user banned successfully');
        }
      } catch (authBanError) {
        console.error('Exception banning auth user:', authBanError);
        // Don't throw - profile deactivation succeeded
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'User deactivated successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in delete-user function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('Forbidden') ? 403 :
               error.message.includes('Missing') ? 400 : 500,
      }
    );
  }
}, 'workforce', 'delete-user'));
