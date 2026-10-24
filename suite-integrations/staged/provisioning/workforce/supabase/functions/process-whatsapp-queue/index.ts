import { withSuiteClient, guardEdge, messagingFetch } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

interface BatchProcessRequest {
  batchSize?: number;
}

interface ProcessingResult {
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
}

// New WhatsApp backend URL (DigitalOcean App Platform)
const WHATSAPP_API_URL = Deno.env.get('WHATSAPP_API_URL') || 'https://lionfish-app-2-7r4qe.ondigitalocean.app/api/send-notification';
const WHATSAPP_API_KEY = Deno.env.get('WHATSAPP_API_KEY') || 'whatsapp-notification-secret-key';

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing required environment variables');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Server configuration error' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const requestBody: BatchProcessRequest = await req.json().catch(() => ({}));
    const batchSize = requestBody.batchSize || 25;

    console.log(`Starting batch WhatsApp processing, batch size: ${batchSize}`);

    // Get pending notifications from the queue
    const { data: pendingNotifications, error: fetchError } = await supabase
      .rpc('get_pending_whatsapp_notifications', { limit_count: batchSize });

    if (fetchError) {
      console.error('Error fetching pending notifications:', fetchError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch pending notifications' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log('No pending notifications to process');
      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0,
          successful: 0,
          failed: 0,
          message: 'No pending notifications'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Processing ${pendingNotifications.length} notifications`);

    const result: ProcessingResult = {
      processed: pendingNotifications.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process each notification
    for (const notification of pendingNotifications) {
      try {
        const success = await processWhatsAppNotification(notification, supabase);
        if (success) {
          result.successful++;
        } else {
          result.failed++;
        }
      } catch (error) {
        console.error(`Error processing notification ${notification.id}:`, error);
        result.failed++;
        result.errors.push(`Notification ${notification.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        // Mark as failed in database
        await supabase
        .from('notifications')
        .update({
          whatsapp_sent: false,
          processing_status: 'failed'
        })
        .eq('id', notification.id);
      }
    }

    console.log(`Batch processing complete:`, result);

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in process-whatsapp-queue function:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
}, 'workforce', 'process-whatsapp-queue'));

async function processWhatsAppNotification(notification: any, supabase: any): Promise<boolean> {
  try {
    // Get organization ID from notification
    const organizationId = notification.organization_id;
    
    if (!organizationId) {
      console.log(`Notification ${notification.id} has no organization_id, skipping`);
      await supabase
        .from('notifications')
        .update({
          whatsapp_sent: false,
          processing_status: 'failed'
        })
        .eq('id', notification.id);
      return false;
    }

    // Check if org has whatsapp_enabled (CHECK 1)
    const { data: org } = await supabase
      .from('organizations')
      .select('id, whatsapp_enabled, whatsapp_api_endpoint')
      .eq('id', organizationId)
      .single();

    if (!org?.whatsapp_enabled) {
      console.log(`Org ${organizationId} has whatsapp_enabled=false, skipping notification ${notification.id}`);
      await supabase
        .from('notifications')
        .update({
          whatsapp_sent: false,
          processing_status: 'failed'
        })
        .eq('id', notification.id);
      return false;
    }

    // Format phone number
    const formattedPhone = formatPhoneForAPI(notification.whatsapp_number);

    // Prepare WhatsApp API request (new format)
    const whatsappPayload = {
      phoneNumber: formattedPhone,
      message: notification.ai_generated_message,
      organizationId: organizationId,  // Required for HR admin check (CHECK 2)
      userId: notification.user_id,
      notificationId: notification.id,
      type: 'queue-notification'
    };

    // Route through the organization's own bridge when it has one, matching
    // send-whatsapp. Sessions are per-deployment, so the wrong host means the
    // message is accepted nowhere.
    const effectiveApiUrl = org.whatsapp_api_endpoint || WHATSAPP_API_URL;

    console.log(`Sending WhatsApp to ${formattedPhone} for notification ${notification.id}, org ${organizationId}, api ${effectiveApiUrl}`);

    // Send message to WhatsApp API with API key
    const whatsappResponse = await messagingFetch(effectiveApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WHATSAPP_API_KEY,
      },
      body: JSON.stringify(whatsappPayload),
    });

    const whatsappResult = await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error('WhatsApp API error for notification', notification.id, ':', whatsappResult);
      
      // Mark as failed
      await supabase
        .from('notifications')
        .update({
          whatsapp_sent: false,
          processing_status: 'failed'
        })
        .eq('id', notification.id);
      
      return false;
    }

    // Mark as successful. Written directly rather than through the RPC: a
    // silent RPC failure here means the row stays whatsapp_sent = false and the
    // next cron run sends the same message again.
    const { error: markError } = await supabase
      .from('notifications')
      .update({
        whatsapp_sent: true,
        whatsapp_sent_at: new Date().toISOString(),
        processing_status: 'completed'
      })
      .eq('id', notification.id);

    if (markError) {
      console.error(`SENT BUT NOT MARKED - notification ${notification.id} will resend:`, markError);
      throw new Error(`Delivered but failed to mark sent: ${markError.message}`);
    }

    console.log(`WhatsApp sent successfully for notification ${notification.id}`);
    return true;

  } catch (error) {
    console.error(`Error processing notification ${notification.id}:`, error);
    throw error;
  }
}

// Kept identical to send-whatsapp's formatPhoneNumber so both senders hand the
// bridge the same E.164 string. Stripping the country code here previously made
// the two paths disagree on what a phone number looks like.
function formatPhoneForAPI(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('91')) {
    return '+' + cleaned;
  }

  if (cleaned.startsWith('0')) {
    return '+91' + cleaned.substring(1);
  }

  if (cleaned.length === 10) {
    return '+91' + cleaned;
  }

  if (!phone.startsWith('+')) {
    return '+' + cleaned;
  }

  return phone;
}
