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
    const { visit_id, dispensed_by, items } = await req.json()
    
    if (!visit_id || !dispensed_by || !items || !Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: visit_id, dispensed_by, items' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check stock availability for all items before dispensing
    for (const item of items) {
      const { data: medicine, error: medicineError } = await supabase
        .from('medicines_master')
        .select('current_stock, name')
        .eq('id', item.medicine_id)
        .single()

      if (medicineError || !medicine) {
        throw new Error(`Medicine not found or error fetching stock for ID: ${item.medicine_id}`)
      }

      if (medicine.current_stock < item.quantity) {
        return new Response(
          JSON.stringify({ 
            error: `Insufficient stock for ${medicine.name}. Available: ${medicine.current_stock}, Requested: ${item.quantity}` 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
    }

    // Prepare dispensed items for insertion
    const dispensedItemsToInsert = items.map((item: any) => ({
      visit_id,
      medicine_id: item.medicine_id,
      quantity: item.quantity,
      dispensed_by,
      dispense_date: new Date().toISOString(),
      selling_price_at_dispense: item.selling_price_at_dispense,
      batch_number: item.batch_number
    }))

    // Insert dispensed items (triggers will handle stock updates)
    const { data: dispensedData, error: dispenseError } = await supabase
      .from('pharmacy_dispensed_items')
      .insert(dispensedItemsToInsert)
      .select(`
        *,
        medicines_master (name, generic_name, dosage_form),
        profiles (name)
      `)

    if (dispenseError) {
      console.error('Error dispensing medicines:', dispenseError)
      throw new Error(`Failed to dispense medicines: ${dispenseError.message}`)
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        dispensedItems: dispensedData,
        message: `Successfully dispensed ${items.length} medicine(s)`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Dispense Medicine Error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to dispense medicines',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})