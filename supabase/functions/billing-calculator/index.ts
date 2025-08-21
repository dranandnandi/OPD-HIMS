import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { visitId, patientId, appointmentType = 'consultation', additionalItems = [] } = await req.json()
    
    if (!visitId || !patientId) {
      return new Response(
        JSON.stringify({ error: 'visitId and patientId are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get clinic settings for fee structure
    const { data: clinicSettings, error: settingsError } = await supabase
      .from('clinic_settings')
      .select('consultation_fee, follow_up_fee, emergency_fee')
      .limit(1)
      .single()

    if (settingsError) {
      console.error('Error fetching clinic settings:', settingsError)
      throw new Error('Failed to fetch clinic settings')
    }

    // Get visit details
    const { data: visit, error: visitError } = await supabase
      .from('visits')
      .select(`
        *,
        profiles!visits_doctor_id_fkey (consultation_fee, follow_up_fee, emergency_fee, role_name, permissions),
        prescriptions (*),
        tests_ordered (*)
      `)
      .eq('id', visitId)
      .single()

    if (visitError) {
      console.error('Error fetching visit:', visitError)
      throw new Error('Failed to fetch visit details')
    }

    // Calculate consultation fee based on appointment type
    let consultationFee = 0
    
    // Check if doctor has specific fees set
    const doctorProfile = visit.profiles
    if (doctorProfile && doctorProfile.consultation_fee !== null) {
      // Use doctor-specific fees
      switch (appointmentType) {
        case 'follow_up':
          consultationFee = doctorProfile.follow_up_fee || doctorProfile.consultation_fee
          break
        case 'emergency':
          consultationFee = doctorProfile.emergency_fee || doctorProfile.consultation_fee
          break
        default:
          consultationFee = doctorProfile.consultation_fee
      }
    } else {
      // Fall back to clinic default fees
      switch (appointmentType) {
        case 'follow_up':
          consultationFee = clinicSettings.follow_up_fee
          break
        case 'emergency':
          consultationFee = clinicSettings.emergency_fee
          break
        default:
          consultationFee = clinicSettings.consultation_fee
      }
    }

    // Prepare bill items
    const billItems = []

    // Add consultation fee
    billItems.push({
      item_type: 'consultation',
      item_name: `${appointmentType.replace('_', ' ')} Consultation`,
      quantity: 1,
      unit_price: consultationFee,
      total_price: consultationFee,
      discount: 0,
      tax: 0
    })

    // Add prescription items (if any charges apply)
    if (visit.prescriptions && visit.prescriptions.length > 0) {
      // For now, we'll add a nominal prescription fee
      // In a real system, you might have medicine prices
      billItems.push({
        item_type: 'medicine',
        item_name: 'Prescription Fee',
        quantity: 1,
        unit_price: 50,
        total_price: 50,
        discount: 0,
        tax: 0
      })
    }

    // Add test fees (if any)
    if (visit.tests_ordered && visit.tests_ordered.length > 0) {
      for (const test of visit.tests_ordered) {
        // Default test prices - in real system, get from tests_master
        let testPrice = 0
        switch (test.test_type) {
          case 'lab':
            testPrice = 200
            break
          case 'radiology':
            testPrice = 500
            break
          default:
            testPrice = 100
        }

        billItems.push({
          item_type: 'test',
          item_name: test.test_name,
          quantity: 1,
          unit_price: testPrice,
          total_price: testPrice,
          discount: 0,
          tax: 0
        })
      }
    }

    // Add any additional items
    for (const item of additionalItems) {
      billItems.push({
        item_type: item.type || 'other',
        item_name: item.name,
        quantity: item.quantity || 1,
        unit_price: item.unitPrice || 0,
        total_price: (item.quantity || 1) * (item.unitPrice || 0),
        discount: item.discount || 0,
        tax: item.tax || 0
      })
    }

    // Calculate totals
    const subtotal = billItems.reduce((sum, item) => sum + item.total_price, 0)
    const totalDiscount = billItems.reduce((sum, item) => sum + (item.discount || 0), 0)
    const totalTax = billItems.reduce((sum, item) => sum + (item.tax || 0), 0)
    const totalAmount = subtotal - totalDiscount + totalTax

    // Generate bill number
    const billNumber = `BILL-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Date.now().toString().slice(-6)}`

    // Create bill record
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .insert([{
        visit_id: visitId,
        patient_id: patientId,
        bill_number: billNumber,
        total_amount: totalAmount,
        paid_amount: 0,
        balance_amount: totalAmount,
        payment_status: 'pending',
        bill_date: new Date().toISOString(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
      }])
      .select()
      .single()

    if (billError) {
      console.error('Error creating bill:', billError)
      throw new Error('Failed to create bill')
    }

    // Create bill items
    const billItemsWithBillId = billItems.map(item => ({
      ...item,
      bill_id: bill.id
    }))

    const { error: itemsError } = await supabase
      .from('bill_items')
      .insert(billItemsWithBillId)

    if (itemsError) {
      console.error('Error creating bill items:', itemsError)
      throw new Error('Failed to create bill items')
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        bill: {
          id: bill.id,
          billNumber: bill.bill_number,
          totalAmount: bill.total_amount,
          paidAmount: bill.paid_amount,
          balanceAmount: bill.balance_amount,
          paymentStatus: bill.payment_status,
          billDate: bill.bill_date,
          dueDate: bill.due_date
        },
        billItems: billItemsWithBillId,
        calculations: {
          subtotal,
          totalDiscount,
          totalTax,
          totalAmount
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Billing Calculator Error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to calculate and create bill',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})