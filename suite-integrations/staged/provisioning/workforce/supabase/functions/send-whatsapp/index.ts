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

interface WhatsAppRequest {
  phoneNumber: string;
  message: string;
  patientName?: string;
  testName?: string;
  doctorName?: string;
  taskId?: string;
  notificationId?: string;
  // Allows callers with no notification row (e.g. the admin "Send test message"
  // action) to name the organization whose WhatsApp session should be used,
  // and the user whose registered session should send it.
  organizationId?: string;
  userId?: string;
}

interface WhatsAppResponse {
  success: boolean;
  messageId?: string;
  error?: string;
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

    const rawBody = await req.json();

    // Supabase Database Webhooks post {type, table, schema, record, old_record}
    // rather than our flat shape. Map the inserted notification onto it so the
    // same function serves both the webhook and direct callers.
    let requestBody: WhatsAppRequest;

    if (rawBody?.record && rawBody?.table === 'notifications') {
      const row = rawBody.record;

      // Nothing to deliver: not every notification is a WhatsApp notification.
      if (!row.whatsapp_number || !row.ai_generated_message || row.whatsapp_sent) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'not a pending WhatsApp notification' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      requestBody = {
        phoneNumber: row.whatsapp_number,
        message: row.ai_generated_message,
        notificationId: row.id,
      };
    } else {
      requestBody = rawBody as WhatsAppRequest;
    }

    const {
      phoneNumber,
      message,
      patientName,
      testName,
      doctorName,
      taskId,
      notificationId,
      organizationId: requestedOrganizationId,
      userId: requestedUserId,
    } = requestBody;

    // Validate required fields
    if (!phoneNumber || !message) {
      return new Response(
        JSON.stringify({ error: 'Phone number and message are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Default to environment API URL
    let EFFECTIVE_API_URL = WHATSAPP_API_URL;
    let organizationId: string | null = null;
    let userId: string | null = null;

    // Check organization WhatsApp settings if notification ID is provided.
    // notifications has no FK to organizations - the org is only reachable via
    // the notified user, so resolve it in explicit steps rather than embedding.
    if (notificationId) {
      const { data: notificationData, error: notificationError } = await supabase
        .from('notifications')
        .select('id, user_id')
        .eq('id', notificationId)
        .single();

      if (notificationError || !notificationData) {
        console.error('Could not load notification', notificationId, notificationError);
      }

      if (notificationData) {
        userId = notificationData.user_id;

        const { data: notifiedUser, error: userLookupError } = await supabase
          .from('users')
          .select('organization_id')
          .eq('id', notificationData.user_id)
          .single();

        if (userLookupError || !notifiedUser?.organization_id) {
          console.error('Could not resolve organization for notification', notificationId, userLookupError);
        }

        const { data: org, error: orgLookupError } = notifiedUser?.organization_id
          ? await supabase
              .from('organizations')
              .select('id, whatsapp_enabled, auto_alerts_enabled, whatsapp_api_endpoint')
              .eq('id', notifiedUser.organization_id)
              .single()
          : { data: null, error: null };

        if (orgLookupError) {
          console.error('Could not load organization', notifiedUser?.organization_id, orgLookupError);
        }

        if (org) {
        organizationId = org.id;

        // CHECK 1: Organization must have whatsapp_enabled = true
        if (!org.whatsapp_enabled) {
          console.log(`WhatsApp disabled for org ${organizationId} (whatsapp_enabled=false)`);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'WhatsApp is disabled for this organization',
              skipped: true 
            }),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        // Use organization-specific API endpoint if configured
        EFFECTIVE_API_URL = org.whatsapp_api_endpoint || WHATSAPP_API_URL;
        }
      }
    } else if (requestedOrganizationId) {
      // No notification row to derive the org from (test sends). Resolve the
      // organization directly and apply the same whatsapp_enabled gate.
      const { data: orgData } = await supabase
        .from('organizations')
        .select('id, whatsapp_enabled, whatsapp_api_endpoint')
        .eq('id', requestedOrganizationId)
        .single();

      if (!orgData) {
        return new Response(
          JSON.stringify({ success: false, error: 'Organization not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!orgData.whatsapp_enabled) {
        console.log(`WhatsApp disabled for org ${orgData.id} (whatsapp_enabled=false)`);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'WhatsApp is disabled for this organization',
            skipped: true
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      organizationId = orgData.id;
      userId = requestedUserId || null;
      EFFECTIVE_API_URL = orgData.whatsapp_api_endpoint || WHATSAPP_API_URL;
    }

    // organizationId is required for the new API (CHECK 2: HR admin must be registered)
    if (!organizationId) {
      console.error('No organizationId found - cannot send WhatsApp notification');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'organizationId is required. Provide notificationId to auto-detect org.' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Format phone number (ensure it starts with country code)
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // Prepare WhatsApp API request (new format for /api/send-notification)
    const whatsappPayload = {
      phoneNumber: formattedPhone,
      message: message,
      organizationId: organizationId,  // Required for HR admin check
      userId: userId,
      notificationId: notificationId,
      title: patientName ? `${patientName} - ${testName || 'Notification'}` : undefined,
      type: 'notification',
      // Legacy fields for compatibility
      patientName: patientName || '',
      testName: testName || '',
      doctorName: doctorName || ''
    };

    console.log('Sending WhatsApp message:', {
      phoneNumber: formattedPhone,
      messageLength: message.length,
      organizationId,
      taskId,
      notificationId,
      apiUrl: EFFECTIVE_API_URL
    });

    // Send message to WhatsApp API with API key authentication
    const whatsappResponse = await messagingFetch(EFFECTIVE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WHATSAPP_API_KEY,  // API key for authentication
      },
      body: JSON.stringify(whatsappPayload),
    });

    const whatsappResult = await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error('WhatsApp API error:', whatsappResult);
      
      // Log failed attempt to database
      if (notificationId) {
        await logWhatsAppAttempt(supabase, notificationId, false, whatsappResult.error || 'API request failed');
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: whatsappResult.error || 'Failed to send WhatsApp message' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Update notification status in database
    if (notificationId) {
      await logWhatsAppAttempt(supabase, notificationId, true, null, whatsappResult.messageId);
    }

    console.log('WhatsApp message sent successfully:', whatsappResult);

    const response: WhatsAppResponse = {
      success: true,
      messageId: whatsappResult.messageId || whatsappResult.id
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in send-whatsapp function:', error);
    
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
}, 'workforce', 'send-whatsapp'));

function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 91 (India), keep as is
  if (cleaned.startsWith('91')) {
    return '+' + cleaned;
  }
  
  // If it starts with 0, remove the 0 and add +91
  if (cleaned.startsWith('0')) {
    return '+91' + cleaned.substring(1);
  }
  
  // If it's 10 digits and doesn't start with country code, assume India
  if (cleaned.length === 10) {
    return '+91' + cleaned;
  }
  
  // If it doesn't start with +, add it
  if (!phone.startsWith('+')) {
    return '+' + cleaned;
  }
  
  return phone;
}

async function logWhatsAppAttempt(
  supabase: any,
  notificationId: string,
  success: boolean,
  error: string | null,
  messageId?: string
) {
  try {
    const updateData: any = {
      whatsapp_sent: success,
      whatsapp_sent_at: new Date().toISOString(),
    };

    if (messageId) {
      updateData.whatsapp_message_id = messageId;
    }

    if (error) {
      updateData.whatsapp_error = error;
    }

    const { error: updateError } = await supabase
      .from('notifications')
      .update(updateData)
      .eq('id', notificationId);

    if (updateError) {
      console.error('Failed to update notification status:', updateError);
    }
  } catch (err) {
    console.error('Error logging WhatsApp attempt:', err);
  }
}
