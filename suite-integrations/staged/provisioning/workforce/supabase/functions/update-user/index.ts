import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateUserRequest {
  userId: string;
  name?: string;
  whatsappNumber?: string;
  phone?: string;
  department?: string;
  role?: 'user' | 'admin' | 'superadmin';
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
      throw new Error('Forbidden: Only admins can update users');
    }

    // Parse request body
    const requestBody: UpdateUserRequest = await req.json();
    const { userId, name, whatsappNumber, phone, department, role } = requestBody;

    if (!userId) {
      throw new Error('Missing user ID');
    }

    // Get the user to be updated
    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (targetUserError || !targetUser) {
      throw new Error('User to update not found');
    }

    // Verify admin is updating user in their own organization
    if (adminUser.organization_id !== targetUser.organization_id) {
      throw new Error('Forbidden: Cannot update users in other organizations');
    }

    // Build update object
    const updates: any = {
      updated_at: new Date().toISOString()
    };

    if (name) {
      updates.name = name
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    if (whatsappNumber) {
      // Validate and format WhatsApp number
      let formattedWhatsApp = whatsappNumber;
      
      // If WhatsApp number doesn't start with +, assume it needs country code
      if (!whatsappNumber.startsWith('+')) {
        const cleanedWhatsApp = whatsappNumber.replace(/\D/g, '');
        if (cleanedWhatsApp.length === 10) {
          formattedWhatsApp = `+91${cleanedWhatsApp}`;
        } else if (cleanedWhatsApp.length === 9) {
          formattedWhatsApp = `+971${cleanedWhatsApp}`;
        } else {
          throw new Error('WhatsApp number must be 10 digits (India) or 9 digits (UAE)');
        }
      } else {
        // Already has country code, validate format
        const match = whatsappNumber.match(/^\+(\d{1,4})(\d+)$/);
        if (!match) {
          throw new Error('Invalid WhatsApp number format');
        }
        const countryCode = match[1];
        const number = match[2];
        
        if (countryCode === '91' && number.length !== 10) {
          throw new Error('Indian WhatsApp number must be 10 digits');
        } else if (countryCode === '971' && number.length !== 9) {
          throw new Error('UAE WhatsApp number must be 9 digits');
        }
      }
      
      updates.whatsapp_number = formattedWhatsApp;
    }

    if (phone !== undefined) {
      updates.phone = phone || null;
    }

    if (department) {
      updates.department = department;
    }

    if (role) {
      updates.role = role;
    }

    // Update user profile
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('*')
      .single();

    if (updateError) {
      throw new Error(`Failed to update user: ${updateError.message}`);
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: updatedProfile.id,
          auth_id: updatedProfile.auth_id,
          organization_id: updatedProfile.organization_id,
          name: updatedProfile.name,
          email: updatedProfile.email,
          whatsapp_number: updatedProfile.whatsapp_number,
          phone: updatedProfile.phone,
          role: updatedProfile.role,
          department: updatedProfile.department,
          created_at: updatedProfile.created_at,
          updated_at: updatedProfile.updated_at
        },
        message: 'User updated successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in update-user function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('Forbidden') ? 403 :
               error.message.includes('Missing') || 
               error.message.includes('Invalid') ? 400 : 500,
      }
    );
  }
}, 'workforce', 'update-user'));
