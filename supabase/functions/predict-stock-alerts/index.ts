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
    console.log('🚀 Starting stock alerts prediction...')
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch all active medicines with their current stock and reorder levels
    const { data: medicines, error: medicinesError } = await supabase
      .from('medicines_master')
      .select('id, name, current_stock, reorder_level, generic_name, brand_name')
      .eq('is_active', true)

    if (medicinesError) {
      console.error('❌ Error fetching medicines:', medicinesError)
      throw new Error(`Failed to fetch medicines: ${medicinesError.message}`)
    }

    console.log(`📊 Analyzing ${medicines.length} active medicines...`)

    const newAlerts = []
    let processedCount = 0
    let lowStockCount = 0

    for (const medicine of medicines) {
      processedCount++
      
      // Check if current stock is below reorder level
      if (medicine.current_stock <= medicine.reorder_level) {
        lowStockCount++
        
        // Check if an unresolved 'low_stock' alert already exists for this medicine
        const { data: existingAlerts, error: existingAlertsError } = await supabase
          .from('stock_alerts')
          .select('id')
          .eq('medicine_id', medicine.id)
          .eq('alert_type', 'low_stock')
          .eq('is_resolved', false)

        if (existingAlertsError) {
          console.error(`⚠️ Error checking existing alerts for ${medicine.name}:`, existingAlertsError.message)
          continue // Skip to next medicine if there's an error checking alerts
        }

        if (existingAlerts.length === 0) {
          // No unresolved low_stock alert exists, create a new one
          const alertMessage = medicine.current_stock === 0 
            ? `OUT OF STOCK: ${medicine.name} is completely out of stock. Reorder immediately!`
            : `LOW STOCK: ${medicine.name} is running low. Current: ${medicine.current_stock}, Reorder Level: ${medicine.reorder_level}`

          newAlerts.push({
            medicine_id: medicine.id,
            alert_type: 'low_stock',
            message: alertMessage
          })
          
          console.log(`🔔 New alert for: ${medicine.name} (Stock: ${medicine.current_stock}/${medicine.reorder_level})`)
        } else {
          console.log(`ℹ️ Alert already exists for: ${medicine.name}`)
        }
      }
    }

    // Insert new alerts if any
    if (newAlerts.length > 0) {
      const { error: insertError } = await supabase
        .from('stock_alerts')
        .insert(newAlerts)

      if (insertError) {
        console.error('❌ Error inserting new alerts:', insertError)
        throw new Error(`Failed to insert new alerts: ${insertError.message}`)
      }
      
      console.log(`✅ Successfully created ${newAlerts.length} new low stock alerts`)
    } else {
      console.log('✅ No new alerts needed')
    }

    // Auto-resolve alerts for medicines that are now above reorder level
    const { data: unresolvedAlerts, error: unresolvedError } = await supabase
      .from('stock_alerts')
      .select('id, medicine_id, medicines_master!inner(current_stock, reorder_level)')
      .eq('alert_type', 'low_stock')
      .eq('is_resolved', false)

    if (unresolvedError) {
      console.error('⚠️ Error fetching unresolved alerts:', unresolvedError)
    } else {
      const alertsToResolve = unresolvedAlerts.filter(alert => 
        alert.medicines_master.current_stock > alert.medicines_master.reorder_level
      )

      if (alertsToResolve.length > 0) {
        const { error: resolveError } = await supabase
          .from('stock_alerts')
          .update({ 
            is_resolved: true, 
            resolved_at: new Date().toISOString() 
          })
          .in('id', alertsToResolve.map(alert => alert.id))

        if (resolveError) {
          console.error('⚠️ Error auto-resolving alerts:', resolveError)
        } else {
          console.log(`✅ Auto-resolved ${alertsToResolve.length} alerts (stock levels restored)`)
        }
      }
    }

    const summary = {
      success: true,
      processed_medicines: processedCount,
      medicines_with_low_stock: lowStockCount,
      new_alerts_created: newAlerts.length,
      timestamp: new Date().toISOString()
    }

    console.log('📈 Stock alerts prediction completed:', summary)

    return new Response(
      JSON.stringify(summary),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('💥 Predict Stock Alerts Error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process stock alerts',
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})