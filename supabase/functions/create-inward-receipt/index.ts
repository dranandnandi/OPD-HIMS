import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supplier_id, invoice_number, receipt_date, total_amount, uploaded_by, invoice_file_url, status, items } = await req.json()
    
    if (!uploaded_by || !receipt_date || !items || !Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: uploaded_by, receipt_date, items' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Insert the main inward receipt record
    const { data: receiptData, error: receiptError } = await supabase
      .from('pharmacy_inward_receipts')
      .insert([{
        supplier_id,
        invoice_number,
        receipt_date,
        total_amount,
        uploaded_by,
        invoice_file_url,
        status: status || 'uploaded'
      }])
      .select()
      .single()

    if (receiptError) {
      console.error('Error creating inward receipt:', receiptError)
      throw new Error(`Failed to create inward receipt: ${receiptError.message}`)
    }

    // Prepare inward items for insertion
    const inwardItemsToInsert = items.map((item: any) => ({
      receipt_id: receiptData.id,
      medicine_id: item.medicine_id,
      quantity: item.quantity,
      unit_cost_price: item.unit_cost_price,
      batch_number: item.batch_number,
      expiry_date: item.expiry_date
    }))

    // Insert inward items (triggers will handle stock updates)
    const { data: itemsData, error: itemsError } = await supabase
      .from('pharmacy_inward_items')
      .insert(inwardItemsToInsert)
      .select()

    if (itemsError) {
      console.error('Error creating inward items:', itemsError)
      throw new Error(`Failed to create inward items: ${itemsError.message}`)
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        receipt: receiptData,
        items: itemsData
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Create Inward Receipt Error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process inward receipt',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})