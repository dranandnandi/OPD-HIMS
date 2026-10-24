import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
/**
 * CCAvenue Payment Initiation Edge Function
 *
 * Creates a payment order and returns encrypted data for CCAvenue redirect.
 *
 * Request body:
 * {
 *   plan_id: string,       // e.g., 'review_booster', 'clinic_growth_suite'
 *   billing_cycle: 'monthly' | 'yearly',
 *   billing_name?: string,
 *   billing_email?: string,
 *   billing_tel?: string,
 *   billing_address?: string,
 *   billing_city?: string,
 *   billing_state?: string,
 *   billing_zip?: string,
 *   billing_country?: string
 * }
 *
 * Response:
 * {
 *   success: true,
 *   order_id: string,
 *   ccavenue_order_id: string,
 *   encrypted_data: string,
 *   access_code: string,
 *   payment_url: string
 * }
 */

import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ccavenueEncrypt, buildQueryString } from '../_shared/ccavenue-crypto.ts';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface InitiateRequest {
  plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  billing_name?: string;
  billing_email?: string;
  billing_tel?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_zip?: string;
  billing_country?: string;
}

Deno.serve(guardEdge(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get CCAvenue credentials from environment
    const merchantId = Deno.env.get('CCAVENUE_MERCHANT_ID');
    const accessCode = Deno.env.get('CCAVENUE_ACCESS_CODE');
    const workingKey = Deno.env.get('CCAVENUE_WORKING_KEY');
    const redirectUrl = Deno.env.get('CCAVENUE_REDIRECT_URL');
    const cancelUrl = Deno.env.get('CCAVENUE_CANCEL_URL');
    const paymentUrl = Deno.env.get('CCAVENUE_PAYMENT_URL') || 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

    if (!merchantId || !accessCode || !workingKey || !redirectUrl || !cancelUrl) {
      console.error('Missing CCAvenue configuration');
      return new Response(
        JSON.stringify({ success: false, error: 'Payment gateway not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token from request header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role for database operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create a client with the user's JWT for auth verification
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify the user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's internal ID from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, contact_email, contact_phone, name')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: InitiateRequest = await req.json();
    const { plan_id, billing_cycle } = body;

    if (!plan_id || !billing_cycle) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing plan_id or billing_cycle' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get plan details
    const { data: plan, error: planError } = await supabase
      .from('saas_plans')
      .select('id, name, monthly_price, yearly_price, currency, is_active')
      .eq('id', plan_id)
      .eq('is_active', true)
      .single();

    if (planError || !plan) {
      return new Response(
        JSON.stringify({ success: false, error: 'Plan not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate amount
    const amount = billing_cycle === 'yearly' ? plan.yearly_price : plan.monthly_price;
    const currency = plan.currency || 'INR';

    // Generate unique order ID (CCAvenue requires alphanumeric, max 30 chars)
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const ccavenueOrderId = `ORD${timestamp}${random}`;

    // Create payment order in database
    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userData.id,
        plan_id,
        billing_cycle,
        amount,
        currency,
        status: 'pending',
        ccavenue_order_id: ccavenueOrderId,
        merchant_param1: userData.id,       // Store user_id for callback
        merchant_param2: plan_id,           // Store plan_id for callback
        merchant_param3: billing_cycle,     // Store billing_cycle for callback
        redirect_url: redirectUrl,
        cancel_url: cancelUrl
      })
      .select()
      .single();

    if (orderError) {
      console.error('Error creating payment order:', orderError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create payment order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build CCAvenue request parameters
    const ccavenueParams = {
      merchant_id: merchantId,
      order_id: ccavenueOrderId,
      amount: amount.toFixed(2),
      currency,
      redirect_url: redirectUrl,
      cancel_url: cancelUrl,
      language: 'EN',
      billing_name: body.billing_name || userData.name || '',
      billing_email: body.billing_email || userData.contact_email || user.email || '',
      billing_tel: body.billing_tel || userData.contact_phone || '',
      billing_address: body.billing_address || '',
      billing_city: body.billing_city || '',
      billing_state: body.billing_state || '',
      billing_zip: body.billing_zip || '',
      billing_country: body.billing_country || 'India',
      merchant_param1: userData.id,
      merchant_param2: plan_id,
      merchant_param3: billing_cycle,
      merchant_param4: plan.name,
      merchant_param5: order.id // Internal order UUID
    };

    // Build query string and encrypt
    const queryString = buildQueryString(ccavenueParams);
    const encryptedData = await ccavenueEncrypt(queryString, workingKey);

    console.log('Payment order created:', {
      orderId: order.id,
      ccavenueOrderId,
      planId: plan_id,
      amount,
      userId: userData.id
    });

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        ccavenue_order_id: ccavenueOrderId,
        encrypted_data: encryptedData,
        access_code: accessCode,
        payment_url: paymentUrl,
        amount,
        currency,
        plan_name: plan.name
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('CCAvenue initiate error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}, 'growth', 'ccavenue-initiate'));
