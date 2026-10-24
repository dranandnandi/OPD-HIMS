import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
/**
 * CCAvenue Guest Checkout Edge Function
 *
 * Pay-first flow for ad landing pages: a visitor with no account picks a plan,
 * fills in business details + a password, and goes straight to CCAvenue.
 *
 * Flow:
 * 1. Validate input and plan
 * 2. Create the account (auth user + users row) with NO features enabled
 *    - If the email already exists, verify the supplied password against it;
 *      on match, reuse the account (lets a buyer retry after a failed payment)
 * 3. Create a payment order and return the encrypted CCAvenue payload
 * 4. On payment success the existing callback + DB trigger activate the plan
 *
 * If payment fails or is abandoned, the account exists with no features —
 * the buyer can log in later and subscribe from /pricing.
 *
 * Called with the public anon key (verify_jwt = true), from any domain
 * (CORS open) — works from the app itself or static landing sites.
 */

import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ccavenueEncrypt, buildQueryString } from '../_shared/ccavenue-crypto.ts';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GuestCheckoutRequest {
  plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  business_name: string;
  admin_name: string;
  email: string;
  phone: string;
  password: string;
  whatsapp?: string;
  gmb_link?: string;
  city?: string;
  state?: string;
}

const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
const emailRule = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function normalizePhone(value?: string) {
  return value ? value.replace(/\D/g, '').slice(0, 15) : null;
}

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const merchantId = Deno.env.get('CCAVENUE_MERCHANT_ID');
    const accessCode = Deno.env.get('CCAVENUE_ACCESS_CODE');
    const workingKey = Deno.env.get('CCAVENUE_WORKING_KEY');
    const redirectUrl = Deno.env.get('CCAVENUE_REDIRECT_URL');
    const cancelUrl = Deno.env.get('CCAVENUE_CANCEL_URL');
    const paymentUrl = Deno.env.get('CCAVENUE_PAYMENT_URL') ||
      'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

    if (!merchantId || !accessCode || !workingKey || !redirectUrl || !cancelUrl) {
      console.error('Missing CCAvenue configuration');
      return json({ success: false, error: 'Payment gateway not configured' }, 500);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body: GuestCheckoutRequest = await req.json();
    const planId = body.plan_id;
    const billingCycle = body.billing_cycle;
    const businessName = body.business_name?.trim();
    const adminName = body.admin_name?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = normalizePhone(body.phone);
    const password = body.password || '';

    if (!planId || (billingCycle !== 'monthly' && billingCycle !== 'yearly')) {
      return json({ success: false, error: 'Missing plan or billing cycle' }, 400);
    }
    if (!businessName) return json({ success: false, error: 'Business name is required' }, 400);
    if (!adminName) return json({ success: false, error: 'Your name is required' }, 400);
    if (!email || !emailRule.test(email)) return json({ success: false, error: 'A valid email is required' }, 400);
    if (!phone || phone.length < 10) return json({ success: false, error: 'A valid phone number is required' }, 400);
    if (!passwordRule.test(password)) {
      return json({
        success: false,
        error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character'
      }, 400);
    }

    // Validate the plan and price server-side
    const { data: plan, error: planError } = await supabase
      .from('saas_plans')
      .select('id, name, monthly_price, yearly_price, currency, is_active')
      .eq('id', planId)
      .eq('is_active', true)
      .single();

    if (planError || !plan) {
      return json({ success: false, error: 'Plan not found or inactive' }, 404);
    }
    const amount = billingCycle === 'yearly' ? plan.yearly_price : plan.monthly_price;
    if (!amount || amount <= 0) {
      return json({ success: false, error: 'Selected billing cycle not available for this plan' }, 400);
    }

    // Find or create the account
    let userId: string;

    const { data: existingUser, error: existingError } = await supabase
      .from('users')
      .select('id')
      .eq('username', email)
      .maybeSingle();

    if (existingError) {
      console.error('Existing-user lookup failed:', existingError);
      return json({ success: false, error: 'Could not verify account' }, 500);
    }

    if (existingUser) {
      // Account exists: verify the supplied password so a buyer can retry a
      // failed/abandoned payment. Wrong password -> tell them to log in instead.
      const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { error: signInError } = await authClient.auth.signInWithPassword({ email, password });
      if (signInError) {
        return json({
          success: false,
          error: 'An account with this email already exists. Please log in to your account and subscribe from the Pricing page.',
          code: 'account_exists'
        }, 409);
      }
      userId = existingUser.id;
    } else {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: adminName, clinic_name: businessName, source: 'guest_checkout', plan_id: planId }
      });
      if (authError || !authData.user?.id) {
        console.error('Auth user creation failed:', authError);
        return json({ success: false, error: `Failed to create account: ${authError?.message || 'unknown error'}` }, 400);
      }
      const authId = authData.user.id;

      // Create profile row with NO features — the payment trigger enables them
      const { data: createdUser, error: insertError } = await supabase
        .from('users')
        .insert({
          auth_id: authId,
          username: email,
          password_hash: 'supabase-auth',
          name: adminName,
          role: 'admin',
          clinic_name: businessName,
          clinic_address: [body.city, body.state].filter(Boolean).join(', ') || 'Not provided',
          gmb_link: body.gmb_link || null,
          primary_color: '#4F46E5',
          secondary_color: '#E5E7EB',
          contact_phone: phone,
          contact_email: email,
          contact_whatsapp: normalizePhone(body.whatsapp) || phone,
          enabled_features: [],
          clinic_keywords: '[]',
          languages: { en: { name: businessName, address: [body.city, body.state].filter(Boolean).join(', ') } },
          default_language: 'en'
        })
        .select('id')
        .single();

      if (insertError || !createdUser) {
        console.error('User profile creation failed:', insertError);
        await supabase.auth.admin.deleteUser(authId);
        return json({ success: false, error: 'Failed to create account profile' }, 500);
      }
      userId = createdUser.id;
    }

    // Create the payment order (same shape as the logged-in flow)
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const ccavenueOrderId = `ORD${timestamp}${random}`;
    const currency = plan.currency || 'INR';

    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userId,
        plan_id: planId,
        billing_cycle: billingCycle,
        amount,
        currency,
        status: 'pending',
        ccavenue_order_id: ccavenueOrderId,
        merchant_param1: userId,
        merchant_param2: planId,
        merchant_param3: billingCycle,
        redirect_url: redirectUrl,
        cancel_url: cancelUrl
      })
      .select()
      .single();

    if (orderError) {
      console.error('Error creating payment order:', orderError);
      return json({ success: false, error: 'Account is ready, but payment could not be started. Please log in and subscribe from the Pricing page.' }, 500);
    }

    const ccavenueParams = {
      merchant_id: merchantId,
      order_id: ccavenueOrderId,
      amount: Number(amount).toFixed(2),
      currency,
      redirect_url: redirectUrl,
      cancel_url: cancelUrl,
      language: 'EN',
      billing_name: adminName,
      billing_email: email,
      billing_tel: phone,
      billing_city: body.city || '',
      billing_state: body.state || '',
      billing_country: 'India',
      merchant_param1: userId,
      merchant_param2: planId,
      merchant_param3: billingCycle,
      merchant_param4: plan.name,
      merchant_param5: order.id
    };

    const encryptedData = await ccavenueEncrypt(buildQueryString(ccavenueParams), workingKey);

    console.log('Guest checkout order created:', {
      orderId: order.id,
      ccavenueOrderId,
      planId,
      amount,
      userId,
      newAccount: !existingUser
    });

    return json({
      success: true,
      order_id: order.id,
      ccavenue_order_id: ccavenueOrderId,
      encrypted_data: encryptedData,
      access_code: accessCode,
      payment_url: paymentUrl,
      amount,
      currency,
      plan_name: plan.name
    });
  } catch (error) {
    console.error('Guest checkout error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, 500);
  }
}, 'growth', 'ccavenue-guest-checkout'));
