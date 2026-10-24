import { withSuiteClient, guardEdge, messagingFetch } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BatchNotification {
  notificationId: string;
  phoneNumber: string;
  message: string;
  userId: string;
}

interface BatchRequest {
  notifications: BatchNotification[];
  batchSize: number;
}

interface WhatsAppResult {
  notificationId: string;
  success: boolean;
  error?: string;
  phoneNumber: string;
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const { notifications, batchSize }: BatchRequest = await req.json()

    console.log(`Processing batch of ${notifications.length} WhatsApp notifications`)

    const results: WhatsAppResult[] = []
    const promises: Promise<WhatsAppResult>[] = []

    // Function to format phone number
    const formatPhoneNumber = (phone: string): string => {
      // Remove any spaces, dashes, or special characters
      let cleaned = phone.replace(/[\s\-\(\)]/g, '')
      
      // Remove leading + if present
      if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1)
      }
      
      // Remove leading 91 if present (India country code)
      if (cleaned.startsWith('91') && cleaned.length === 12) {
        cleaned = cleaned.substring(2)
      }
      
      return cleaned
    }

    // Function to log WhatsApp attempt
    const logWhatsAppAttempt = async (
      notificationId: string,
      phoneNumber: string,
      message: string,
      success: boolean,
      error?: string
    ) => {
      try {
        await supabaseClient
          .from('whatsapp_logs')
          .insert({
            notification_id: notificationId,
            phone_number: phoneNumber,
            message: message.substring(0, 500), // Truncate long messages
            success,
            error_message: error,
            sent_at: new Date().toISOString()
          })
      } catch (logError) {
        console.error('Failed to log WhatsApp attempt:', logError)
      }
    }

    // Function to send single WhatsApp message
    const sendWhatsAppMessage = async (notification: BatchNotification): Promise<WhatsAppResult> => {
      const formattedNumber = formatPhoneNumber(notification.phoneNumber)
      
      try {
        // Get organization settings for the user
        const { data: userData, error: userError } = await supabaseClient
          .from('users')
          .select('organization_id, organizations(whatsapp_endpoint)')
          .eq('id', notification.userId)
          .single()

        if (userError || !userData) {
          throw new Error(`User not found: ${userError?.message}`)
        }

        const organizationId = userData.organization_id
        const whatsappEndpoint = userData.organizations?.whatsapp_endpoint

        if (!whatsappEndpoint) {
          throw new Error('WhatsApp endpoint not configured for organization')
        }

        console.log(`Sending WhatsApp to ${formattedNumber} via ${whatsappEndpoint}`)

        // Get API key from environment
        const WHATSAPP_API_KEY = Deno.env.get('WHATSAPP_API_KEY') || 'whatsapp-notification-secret-key';

        // Make the API call to WhatsApp service with API key and organizationId
        const response = await messagingFetch(whatsappEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': WHATSAPP_API_KEY,
          },
          body: JSON.stringify({
            phoneNumber: formattedNumber,
            message: notification.message,
            organizationId: organizationId,
            notificationId: notification.notificationId,
            type: 'batch-send'
          })
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`)
        }

        const result = await response.json()
        
        // Log successful attempt
        await logWhatsAppAttempt(
          notification.notificationId,
          formattedNumber,
          notification.message,
          true
        )

        console.log(`✅ WhatsApp sent successfully to ${formattedNumber}`)
        
        return {
          notificationId: notification.notificationId,
          success: true,
          phoneNumber: formattedNumber
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        // Log failed attempt
        await logWhatsAppAttempt(
          notification.notificationId,
          formattedNumber,
          notification.message,
          false,
          errorMessage
        )

        console.error(`❌ Failed to send WhatsApp to ${formattedNumber}:`, errorMessage)
        
        return {
          notificationId: notification.notificationId,
          success: false,
          error: errorMessage,
          phoneNumber: formattedNumber
        }
      }
    }

    // Process all notifications concurrently with controlled parallelism
    const CONCURRENT_LIMIT = 5 // Limit concurrent requests to avoid overwhelming the API
    
    for (let i = 0; i < notifications.length; i += CONCURRENT_LIMIT) {
      const batch = notifications.slice(i, i + CONCURRENT_LIMIT)
      const batchPromises = batch.map(notification => sendWhatsAppMessage(notification))
      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
    }

    // Calculate statistics
    const successCount = results.filter(r => r.success).length
    const failureCount = results.filter(r => !r.success).length
    const successRate = notifications.length > 0 ? (successCount / notifications.length * 100).toFixed(2) : '0'

    console.log(`Batch processing complete: ${successCount} success, ${failureCount} failures (${successRate}% success rate)`)

    return new Response(
      JSON.stringify({
        success: true,
        batchSize: notifications.length,
        processed: results.length,
        successCount,
        failureCount,
        successRate: parseFloat(successRate),
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Batch WhatsApp processing error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        results: []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}, 'workforce', 'send-whatsapp-batch'))
