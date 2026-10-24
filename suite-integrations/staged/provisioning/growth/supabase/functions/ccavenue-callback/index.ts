import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
/**
 * CCAvenue Payment Callback Edge Function
 *
 * Receives encrypted response from CCAvenue, decrypts it, and updates payment status.
 * On successful payment, activates the user's subscription via database trigger.
 *
 * CCAvenue POSTs form data with:
 * - encResp: Encrypted response string
 * - orderNo: Order ID (optional)
 *
 * This function:
 * 1. Decrypts the response
 * 2. Records the transaction
 * 3. Database trigger handles subscription activation
 * 4. Redirects user to success/failure page
 */

import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ccavenueDecrypt, parseResponse } from '../_shared/ccavenue-crypto.ts';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    // Get CCAvenue credentials
    const workingKey = Deno.env.get('CCAVENUE_WORKING_KEY');
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://app.yourdomain.com';

    if (!workingKey) {
      console.error('Missing CCAVENUE_WORKING_KEY');
      return redirectToFrontend(frontendUrl, 'error', 'Payment gateway configuration error');
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse form data from CCAvenue
    const formData = await req.formData();
    const encResp = formData.get('encResp');

    if (!encResp || typeof encResp !== 'string') {
      console.error('Missing encrypted response from CCAvenue');
      return redirectToFrontend(frontendUrl, 'error', 'Invalid payment response');
    }

    // Decrypt the response
    let decryptedResponse: string;
    try {
      decryptedResponse = await ccavenueDecrypt(encResp, workingKey);
    } catch (decryptError) {
      console.error('Failed to decrypt CCAvenue response:', decryptError);
      return redirectToFrontend(frontendUrl, 'error', 'Failed to process payment response');
    }

    // Parse the decrypted response
    const response = parseResponse(decryptedResponse);

    console.log('CCAvenue response received:', {
      order_id: response.order_id,
      tracking_id: response.tracking_id,
      order_status: response.order_status,
      payment_mode: response.payment_mode,
      amount: response.amount
    });

    // Get key fields from response
    const ccavenueOrderId = response.order_id;
    const trackingId = response.tracking_id;
    const orderStatus = response.order_status; // Success, Failure, Aborted, Invalid
    const internalOrderId = response.merchant_param5; // Our UUID

    if (!ccavenueOrderId) {
      console.error('Missing order_id in CCAvenue response');
      return redirectToFrontend(frontendUrl, 'error', 'Invalid payment response');
    }

    // Find the payment order
    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('ccavenue_order_id', ccavenueOrderId)
      .single();

    if (orderError || !order) {
      console.error('Payment order not found:', ccavenueOrderId);
      return redirectToFrontend(frontendUrl, 'error', 'Payment order not found');
    }

    // Replay guard: if this order was already completed (duplicate/replayed callback),
    // don't record anything again — just show the success page.
    if (order.status === 'completed') {
      console.log('Order already completed, ignoring duplicate callback:', ccavenueOrderId);
      return redirectToFrontend(frontendUrl, 'success', 'Payment successful!', {
        order_id: order.id,
        plan_id: order.plan_id,
        tracking_id: trackingId || ''
      });
    }

    // Amount verification: the decrypted amount must match what we charged for.
    // A mismatch means tampering or a gateway inconsistency — record it as Invalid
    // so the activation trigger does NOT fire, and flag for manual review.
    let effectiveStatus = orderStatus;
    const respAmount = parseFloat(response.amount);
    if (orderStatus === 'Success' && (!isFinite(respAmount) || Math.abs(respAmount - parseFloat(order.amount)) > 0.01)) {
      console.error('AMOUNT MISMATCH on order', ccavenueOrderId, {
        expected: order.amount,
        received: response.amount,
        tracking_id: trackingId
      });
      effectiveStatus = 'Invalid';
    }

    // Record the transaction
    const { error: transactionError } = await supabase
      .from('payment_transactions')
      .insert({
        order_id: order.id,
        tracking_id: trackingId,
        bank_ref_no: response.bank_ref_no,
        order_status: effectiveStatus,
        payment_mode: response.payment_mode,
        card_name: response.card_name,
        status_code: response.status_code,
        status_message: response.status_message,
        currency: response.currency || order.currency,
        amount: parseFloat(response.amount) || order.amount,
        billing_name: response.billing_name,
        billing_email: response.billing_email,
        billing_tel: response.billing_tel,
        billing_address: response.billing_address,
        billing_city: response.billing_city,
        billing_state: response.billing_state,
        billing_zip: response.billing_zip,
        billing_country: response.billing_country,
        response_code: response.response_code,
        failure_message: response.failure_message,
        raw_response: response
      });

    if (transactionError) {
      // 23505 = unique violation on the one-Success-per-order index: a concurrent
      // duplicate already recorded this payment. Treat as already processed.
      if ((transactionError as { code?: string }).code === '23505' && effectiveStatus === 'Success') {
        console.log('Success transaction already recorded for order:', ccavenueOrderId);
        return redirectToFrontend(frontendUrl, 'success', 'Payment successful!', {
          order_id: order.id,
          plan_id: order.plan_id,
          tracking_id: trackingId || ''
        });
      }
      console.error('Failed to record transaction:', transactionError);
      // Continue anyway - don't fail the user experience
    }

    // Amount mismatch: hold the order for manual review, do not activate
    if (effectiveStatus === 'Invalid') {
      await supabase
        .from('payment_orders')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', order.id);
      return redirectToFrontend(
        frontendUrl,
        'error',
        'Payment received but requires verification. Our team will review it shortly.',
        { order_id: order.id }
      );
    }

    // Update order status for non-success cases
    // (Success case is handled by database trigger)
    if (effectiveStatus !== 'Success') {
      const newStatus = effectiveStatus === 'Aborted' ? 'cancelled' : 'failed';
      await supabase
        .from('payment_orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', order.id);
    }

    // Redirect based on status
    if (effectiveStatus === 'Success') {
      return redirectToFrontend(
        frontendUrl,
        'success',
        'Payment successful!',
        {
          order_id: order.id,
          plan_id: order.plan_id,
          tracking_id: trackingId
        }
      );
    } else if (effectiveStatus === 'Aborted') {
      return redirectToFrontend(
        frontendUrl,
        'cancelled',
        'Payment was cancelled',
        { order_id: order.id }
      );
    } else {
      return redirectToFrontend(
        frontendUrl,
        'failure',
        response.failure_message || response.status_message || 'Payment failed',
        { order_id: order.id }
      );
    }

  } catch (error) {
    console.error('CCAvenue callback error:', error);
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://app.yourdomain.com';
    return redirectToFrontend(frontendUrl, 'error', 'An error occurred processing your payment');
  }
}, 'growth', 'ccavenue-callback'));

/**
 * Redirect user to frontend with status
 */
function redirectToFrontend(
  baseUrl: string,
  status: 'success' | 'failure' | 'cancelled' | 'error',
  message: string,
  extra?: Record<string, string>
): Response {
  const params = new URLSearchParams({
    status,
    message,
    ...extra
  });

  const redirectUrl = `${baseUrl}/payment/result?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectUrl,
      ...corsHeaders
    }
  });
}
