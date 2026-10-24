import { withSuiteClient, guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
/**
 * CCAvenue Payment Reconciliation Edge Function
 *
 * The redirect callback is browser-mediated: if a user pays but closes the tab
 * before CCAvenue redirects them back, the order stays 'pending' forever even
 * though they were charged. This function closes that gap by polling CCAvenue's
 * Order Status API (orderStatusTracker) for recent pending orders.
 *
 * For each pending order (older than 3 minutes, younger than 48 hours):
 * - Successful/Shipped  -> insert a Success payment_transaction (DB trigger activates subscription)
 * - Unsuccessful/Failed -> mark order failed
 * - Aborted/Cancelled   -> mark order cancelled
 * - Awaited/Initiated   -> leave pending (still in progress)
 *
 * Also runs expire_pending_payment_orders() and expire_overdue_subscriptions()
 * as a fallback for environments without pg_cron.
 *
 * Security: deployed with verify_jwt = false (called by cron, not a user),
 * protected instead by the x-cron-secret header matched against CRON_SECRET.
 */

import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ccavenueEncrypt, ccavenueDecrypt } from '../_shared/ccavenue-crypto.ts';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  // Authenticate the cron caller
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    console.error('CRON_SECRET not configured');
    return jsonResponse({ success: false, error: 'Reconciliation not configured' }, 500);
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }

  const accessCode = Deno.env.get('CCAVENUE_ACCESS_CODE');
  const workingKey = Deno.env.get('CCAVENUE_WORKING_KEY');
  const statusApiUrl = Deno.env.get('CCAVENUE_STATUS_API_URL') ||
    'https://api.ccavenue.com/apis/servlet/DoWebTrans';

  if (!accessCode || !workingKey) {
    return jsonResponse({ success: false, error: 'CCAvenue credentials not configured' }, 500);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Pending orders old enough that the user should have returned by now,
    // but recent enough to still be worth reconciling
    const now = Date.now();
    const { data: orders, error: ordersError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('status', 'pending')
      .lt('created_at', new Date(now - 3 * 60 * 1000).toISOString())
      .gt('created_at', new Date(now - 48 * 60 * 60 * 1000).toISOString())
      .limit(25);

    if (ordersError) throw ordersError;

    const results: Array<Record<string, unknown>> = [];

    for (const order of orders || []) {
      try {
        const status = await fetchOrderStatus(order.ccavenue_order_id, accessCode, workingKey, statusApiUrl);
        results.push({ order: order.ccavenue_order_id, gateway_status: status?.order_status ?? 'unknown' });

        if (!status || !status.order_status) continue;

        const gatewayStatus = String(status.order_status).toLowerCase();

        if (gatewayStatus === 'successful' || gatewayStatus === 'shipped' || gatewayStatus === 'success') {
          // Record a Success transaction; the DB trigger activates the subscription.
          // The partial unique index makes this idempotent.
          const { error: txError } = await supabase.from('payment_transactions').insert({
            order_id: order.id,
            tracking_id: status.reference_no || null,
            bank_ref_no: status.order_bank_ref_no || null,
            order_status: 'Success',
            payment_mode: status.order_option_type || null,
            status_message: 'Reconciled via order status API',
            currency: status.order_currncy || order.currency,
            amount: parseFloat(status.order_amt) || order.amount,
            raw_response: status
          });
          if (txError && (txError as { code?: string }).code !== '23505') {
            console.error('Failed to record reconciled transaction:', order.ccavenue_order_id, txError);
          }
        } else if (gatewayStatus === 'unsuccessful' || gatewayStatus === 'failed' || gatewayStatus === 'invalid' || gatewayStatus === 'timeout') {
          await supabase.from('payment_orders')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('id', order.id)
            .eq('status', 'pending');
        } else if (gatewayStatus === 'aborted' || gatewayStatus === 'cancelled') {
          await supabase.from('payment_orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', order.id)
            .eq('status', 'pending');
        }
        // Awaited / Initiated / anything else: leave pending for the next run
      } catch (orderError) {
        console.error('Reconcile failed for order:', order.ccavenue_order_id, orderError);
        results.push({ order: order.ccavenue_order_id, error: String(orderError) });
      }
    }

    // Maintenance fallback (harmless if pg_cron already ran them)
    const { data: expiredOrders } = await supabase.rpc('expire_pending_payment_orders');
    const { data: expiredSubs } = await supabase.rpc('expire_overdue_subscriptions');

    return jsonResponse({
      success: true,
      checked: results.length,
      results,
      expired_orders: expiredOrders ?? 0,
      expired_subscriptions: expiredSubs ?? 0
    });
  } catch (error) {
    console.error('Reconciliation error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Internal error'
    }, 500);
  }
}, 'growth', 'ccavenue-reconcile'));

/**
 * Query CCAvenue's orderStatusTracker API for a single order.
 * Returns the parsed status record, or null if the gateway has no record of it.
 */
async function fetchOrderStatus(
  ccavenueOrderId: string,
  accessCode: string,
  workingKey: string,
  statusApiUrl: string
): Promise<Record<string, string> | null> {
  const requestJson = JSON.stringify({ order_no: ccavenueOrderId });
  const encRequest = await ccavenueEncrypt(requestJson, workingKey);

  const body = new URLSearchParams({
    enc_request: encRequest,
    access_code: accessCode,
    command: 'orderStatusTracker',
    request_type: 'JSON',
    response_type: 'JSON',
    version: '1.2'
  });

  const res = await runtimeFetch(statusApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    throw new Error(`Status API HTTP ${res.status}`);
  }

  // Response format: status=0&enc_response=<hex>  (status=1 means API-level error)
  const text = (await res.text()).trim();
  const params = new URLSearchParams(text);
  const apiStatus = params.get('status');
  const encResponse = (params.get('enc_response') || '').trim();

  if (apiStatus !== '0' || !encResponse) {
    console.error('Status API error for', ccavenueOrderId, ':', text.substring(0, 300));
    return null;
  }

  const decrypted = await ccavenueDecrypt(encResponse, workingKey);
  const parsed = JSON.parse(decrypted);

  // The tracker may return the record directly or wrapped in Order_Status_Result
  const record = parsed?.Order_Status_Result ?? parsed;
  if (record?.status === 1 || record?.error_desc) {
    console.error('Status API record error for', ccavenueOrderId, ':', record?.error_desc);
    return null;
  }
  return record as Record<string, string>;
}
