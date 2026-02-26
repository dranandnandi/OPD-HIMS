
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { email } = await req.json();
        if (!email) {
            throw new Error('Email is required');
        }

        // Create a Supabase client with the SERVICE_ROLE_KEY to perform admin actions
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 1. Resolve Query to get User ID (Service Role can select from auth.users via RPC or listUsers)
        // We will use listUsers for safety inside the JS client, though strictly it lists 50 by default.
        // A better way for exact email match without listing all is trying to find it via a direct DB query if exposed, 
        // or just iterating if you have few users. 
        // BUT since we just created a 'delete_user_by_email' RPC function in SQL, using that is EFFICIENT!

        // Method A: Use the custom SQL function (Recommended if you ran the migration)
        const { data, error } = await supabaseAdmin.rpc('delete_user_by_email', {
            email_to_delete: email
        });

        if (error) throw error;

        return new Response(
            JSON.stringify({
                message: 'Operation completed',
                result: data
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
