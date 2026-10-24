import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GetUsersRequest {
  organizationId: string;
  searchQuery?: string;
  role?: 'user' | 'admin' | 'superadmin';
  department?: string;
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Get Users Request ===');

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
    const requestBody: GetUsersRequest = await req.json();
    const { organizationId, searchQuery, role, department } = requestBody;

    console.log('Request params:', { organizationId, searchQuery, role, department });

    // Validate required fields
    if (!organizationId) {
      throw new Error('organizationId is required');
    }

    // Verify organization exists
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !orgData) {
      throw new Error('Organization not found');
    }

    console.log('Organization verified:', orgData.name);

    // Build query
    let query = supabaseAdmin
      .from('users')
      .select('id, name, email, whatsapp_number, role, department, created_at')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    // Apply filters
    if (role) {
      query = query.eq('role', role);
    }

    if (department) {
      query = query.eq('department', department);
    }

    if (searchQuery) {
      // Soft search: Split query into words and search each word
      const searchWords = searchQuery.trim().toLowerCase().split(/\s+/);
      
      // Search across name, email, and department for better matching
      // This allows: "priyanka" to match "Panchal Priyanka"
      // Or: "panchal priyanka" to match "Priyanka Panchal"
      if (searchWords.length === 1) {
        // Single word: simple OR search across fields
        query = query.or(`name.ilike.%${searchWords[0]}%,email.ilike.%${searchWords[0]}%,department.ilike.%${searchWords[0]}%`);
      } else {
        // Multiple words: match ALL words in name (in any order)
        searchWords.forEach(word => {
          query = query.ilike('name', `%${word}%`);
        });
      }
    }

    // Execute query
    const { data: users, error: usersError } = await query;

    if (usersError) {
      console.error('Users query error:', usersError);
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    console.log(`Found ${users?.length || 0} users`);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          organization: {
            id: orgData.id,
            name: orgData.name
          },
          users: users || [],
          count: users?.length || 0
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-get-users function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('not found') ? 404 :
               error.message.includes('required') ? 400 : 500,
      }
    );
  }
}, 'workforce', 'whatsapp-get-users'));
