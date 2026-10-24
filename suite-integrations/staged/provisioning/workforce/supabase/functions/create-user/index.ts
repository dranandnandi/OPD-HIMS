import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  whatsappNumber: string;
  phone: string;
  role: 'user' | 'admin' | 'superadmin';
  department: string;
  organizationId: string;
}

function errorResponse(status: number, code: string, message: string, details?: string[]) {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      code,
      details
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    }
  );
}

function mapAuthCreateError(error: { message?: string; status?: number; code?: string }) {
  const rawMessage = error.message || 'Failed to create auth user';
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes('already registered') ||
    normalizedMessage.includes('already been registered') ||
    normalizedMessage.includes('user already registered') ||
    normalizedMessage.includes('duplicate')
  ) {
    return {
      status: 409,
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'This email address is already in use.'
    };
  }

  if (normalizedMessage.includes('password')) {
    return {
      status: 400,
      code: 'INVALID_PASSWORD',
      message: rawMessage
    };
  }

  if (normalizedMessage.includes('email')) {
    return {
      status: 400,
      code: 'INVALID_EMAIL',
      message: rawMessage
    };
  }

  return {
    status: error.status || 500,
    code: error.code || 'AUTH_CREATE_FAILED',
    message: rawMessage
  };
}

async function findAuthUserByEmail(supabaseAdmin: any, email: string) {
  const { data, error } = await supabaseAdmin.rpc('get_unused_auth_users');

  if (error) {
    return { user: null, error };
  }

  const matchingUser = (data ?? []).find(
    (authUser: { email?: string }) => authUser.email?.trim().toLowerCase() === email
  );

  return { user: matchingUser ?? null, error: null };
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
      return errorResponse(401, 'MISSING_AUTH_HEADER', 'Missing authorization header');
    }

    // Extract JWT token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client with service role for admin operations
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
      return errorResponse(401, 'UNAUTHORIZED', 'Invalid or expired session. Please log in again.');
    }

    // Verify the requesting user is an admin in their organization
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('users')
      .select('role, organization_id')
      .eq('auth_id', user.id)
      .single();

    if (adminCheckError || !adminUser) {
      return errorResponse(404, 'ADMIN_USER_NOT_FOUND', 'Your admin user record was not found.');
    }

    if (!['admin', 'superadmin'].includes(adminUser.role)) {
      return errorResponse(403, 'INSUFFICIENT_PERMISSIONS', 'Only admins can create users.');
    }

    // Parse request body
    const requestBody: CreateUserRequest = await req.json();
    const { email, password, name, whatsappNumber, phone, role, department, organizationId } = requestBody;
    const normalizedPhone = phone?.trim() ?? '';

    // Validate that admin is creating user in their own organization
    if (adminUser.organization_id !== organizationId) {
      return errorResponse(403, 'ORGANIZATION_MISMATCH', 'You can only create users in your own organization.');
    }

    // Validate required fields
    if (!email || !password || !name || !whatsappNumber || !normalizedPhone || !role || !department || !organizationId) {
      return errorResponse(400, 'MISSING_REQUIRED_FIELDS', 'Please fill in all required fields.', [
        'Full name is required',
        'Email is required',
        'Password is required',
        'WhatsApp number is required',
        'Phone number is required',
        'Department is required'
      ]);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return errorResponse(400, 'INVALID_EMAIL_FORMAT', 'Please enter a valid email address.');
    }

    if (!/^\+?\d{7,15}$/.test(normalizedPhone)) {
      return errorResponse(400, 'INVALID_PHONE_NUMBER', 'Phone number must contain only digits and be 7 to 15 digits long.');
    }

    // Validate password length
    if (password.length < 6) {
      return errorResponse(400, 'WEAK_PASSWORD', 'Password must be at least 6 characters.');
    }

    // Validate and format WhatsApp number
    let formattedWhatsApp = whatsappNumber;
    
    // If WhatsApp number doesn't start with +, assume it needs country code
    if (!whatsappNumber.startsWith('+')) {
      // Check if it's 10 digits (India) or 9 digits (UAE)
      const cleanedWhatsApp = whatsappNumber.replace(/\D/g, '');
      if (cleanedWhatsApp.length === 10) {
        formattedWhatsApp = `+91${cleanedWhatsApp}`;
      } else if (cleanedWhatsApp.length === 9) {
        formattedWhatsApp = `+971${cleanedWhatsApp}`;
      } else {
        return errorResponse(400, 'INVALID_WHATSAPP_NUMBER', 'WhatsApp number must be 10 digits for India or 9 digits for UAE.');
      }
    } else {
      // Already has country code, validate format
      const match = whatsappNumber.match(/^\+(\d{1,4})(\d+)$/);
      if (!match) {
        return errorResponse(400, 'INVALID_WHATSAPP_NUMBER', 'Please enter a valid WhatsApp number with country code.');
      }
      const countryCode = match[1];
      const number = match[2];
      
      if (countryCode === '91' && number.length !== 10) {
        return errorResponse(400, 'INVALID_WHATSAPP_NUMBER', 'Indian WhatsApp number must be exactly 10 digits.');
      } else if (countryCode === '971' && number.length !== 9) {
        return errorResponse(400, 'INVALID_WHATSAPP_NUMBER', 'UAE WhatsApp number must be exactly 9 digits.');
      }
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return errorResponse(409, 'EMAIL_ALREADY_EXISTS', 'This email address is already in use.');
    }

    // Title case the name
    const titleCaseName = name
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    console.log('Creating auth user for:', normalizedEmail);

    // Step 1: Create user in Supabase Auth
    const { data: authData, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: titleCaseName,
        role: role,
        phone: normalizedPhone
      }
    });

    let authUser = authData.user;
    let createdAuthUser = false;

    if (authCreateError) {
      console.error('Auth user creation error:', authCreateError);
      const mappedError = mapAuthCreateError(authCreateError);

      if (mappedError.code !== 'EMAIL_ALREADY_EXISTS') {
        return errorResponse(mappedError.status, mappedError.code, mappedError.message);
      }

      console.log('Auth user already exists; checking for a missing public profile:', normalizedEmail);
      const { user: existingAuthUser, error: authLookupError } = await findAuthUserByEmail(
        supabaseAdmin,
        normalizedEmail
      );

      if (authLookupError) {
        console.error('Existing auth user lookup failed:', authLookupError);
        return errorResponse(
          500,
          'AUTH_LOOKUP_FAILED',
          'The login account exists, but it could not be loaded to create the user profile.'
        );
      }

      if (!existingAuthUser) {
        return errorResponse(mappedError.status, mappedError.code, mappedError.message);
      }

      const { data: linkedProfile, error: linkedProfileError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('auth_id', existingAuthUser.id)
        .maybeSingle();

      if (linkedProfileError) {
        console.error('Existing auth profile check failed:', linkedProfileError);
        return errorResponse(
          500,
          'PROFILE_LOOKUP_FAILED',
          'The login account exists, but its user profile could not be checked.'
        );
      }

      if (linkedProfile) {
        return errorResponse(409, 'EMAIL_ALREADY_EXISTS', 'This email address is already in use.');
      }

      authUser = existingAuthUser;
    } else {
      createdAuthUser = true;
    }

    if (!authUser) {
      return errorResponse(500, 'AUTH_CREATE_FAILED', 'No user data was returned while creating the login account.');
    }

    console.log(
      createdAuthUser ? 'Auth user created successfully:' : 'Reusing existing auth user:',
      authUser.id
    );

    // Step 2: Create user profile in public.users table
    const profileData = {
      auth_id: authUser.id,
      organization_id: organizationId,
      name: titleCaseName,
      email: normalizedEmail,
      whatsapp_number: formattedWhatsApp,
      phone: normalizedPhone,
      role: role,
      department: department,
      onboarding_state: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating user profile with data:', JSON.stringify(profileData, null, 2));

    const { data: profileResult, error: profileError } = await supabaseAdmin
      .from('users')
      .insert([profileData])
      .select('*')
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      console.error('Profile error details:', JSON.stringify(profileError, null, 2));
      console.error('Profile error code:', profileError.code);
      console.error('Profile error message:', profileError.message);
      console.error('Profile error hint:', profileError.hint);
      
      // Only roll back an auth account created by this request.
      if (createdAuthUser) {
        console.log('Cleaning up auth user due to profile creation failure...');
        try {
          await supabaseAdmin.auth.admin.deleteUser(authUser.id);
          console.log('Auth user cleanup successful');
        } catch (cleanupError) {
          console.error('Failed to cleanup auth user:', cleanupError);
        }
      }
      
      if (profileError.code === '23505') {
        return errorResponse(409, 'USER_ALREADY_EXISTS', 'A user with this email or phone already exists.');
      }

      return errorResponse(500, 'PROFILE_CREATE_FAILED', `Failed to create user profile: ${profileError.message}`);
    }

    console.log('User profile created successfully:', profileResult.id);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: profileResult.id,
          auth_id: profileResult.auth_id,
          organization_id: profileResult.organization_id,
          name: profileResult.name,
          email: profileResult.email,
          whatsapp_number: profileResult.whatsapp_number,
          phone: profileResult.phone,
          role: profileResult.role,
          department: profileResult.department,
          created_at: profileResult.created_at,
          updated_at: profileResult.updated_at
        },
        message: createdAuthUser
          ? 'User created successfully'
          : 'Existing login account linked to a new user profile successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in create-user function:', error);
    return errorResponse(500, 'UNEXPECTED_ERROR', error.message || 'An unexpected error occurred while creating the user.');
  }
}, 'workforce', 'create-user'));
