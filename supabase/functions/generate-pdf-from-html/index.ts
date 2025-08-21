import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
    const { type, data } = await req.json()

    if (!type || !data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: type and data' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const pdfCoApiKey = Deno.env.get('PDF_CO_API')
    if (!pdfCoApiKey) {
      return new Response(
        JSON.stringify({ error: 'PDF.co API key not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    let htmlContent = '';
    let filename = 'document.pdf';

    // Dynamic HTML Generation based on type
    if (type === 'bill') {
      const { bill, patient, doctor, clinicSettings } = data;
      filename = `Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Bill #${bill.billNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #333; line-height: 1.4; }
            .header { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; color: #0066FF; }
            .header p { margin: 5px 0; font-size: 12px; }
            .details-section { display: flex; justify-content: space-between; margin-bottom: 20px; }
            .details-section > div { width: 48%; border: 1px solid #eee; padding: 15px; border-radius: 5px; }
            .details-section h3 { margin-top: 0; font-size: 16px; color: #0066FF; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #eee; padding: 8px; text-align: left; font-size: 12px; }
            th { background-color: #f9f9f9; font-weight: bold; }
            .summary { width: 300px; margin-left: auto; border: 1px solid #eee; padding: 15px; border-radius: 5px; }
            .summary div { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
            .summary .total { font-weight: bold; border-top: 1px solid #eee; margin-top: 10px; padding-top: 10px; }
            .footer { text-align: center; font-size: 10px; color: #777; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; }
            .status { display: inline-block; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }
            .status-paid { background-color: #d4edda; color: #155724; }
            .status-pending { background-color: #fff3cd; color: #856404; }
            .status-partial { background-color: #cce7ff; color: #004085; }
            .status-overdue { background-color: #f8d7da; color: #721c24; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${clinicSettings.clinicName}</h1>
            <p>${clinicSettings.address}</p>
            <p>Phone: ${clinicSettings.phone}${clinicSettings.email ? ` | Email: ${clinicSettings.email}` : ''}</p>
            ${clinicSettings.registrationNumber ? `<p>Registration No: ${clinicSettings.registrationNumber}</p>` : ''}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
              <h2 style="margin: 0;">BILL / INVOICE</h2>
              <p style="margin: 5px 0;"><strong>Bill No:</strong> ${bill.billNumber}</p>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(bill.billDate).toLocaleDateString('en-IN')}</p>
            </div>
            <div>
              <span class="status status-${bill.paymentStatus}">${bill.paymentStatus.toUpperCase()}</span>
            </div>
          </div>

          <div class="details-section">
            <div>
              <h3>PATIENT DETAILS</h3>
              <p><strong>Name:</strong> ${patient.name}</p>
              <p><strong>Phone:</strong> ${patient.phone}</p>
              <p><strong>Age:</strong> ${patient.age} years</p>
              <p><strong>Gender:</strong> ${patient.gender}</p>
              ${patient.bloodGroup ? `<p><strong>Blood Group:</strong> ${patient.bloodGroup}</p>` : ''}
              <p><strong>Address:</strong> ${patient.address}</p>
            </div>
            <div>
              <h3>DOCTOR DETAILS</h3>
              <p><strong>Name:</strong> Dr. ${doctor?.name || 'Not specified'}</p>
              ${doctor?.specialization ? `<p><strong>Specialization:</strong> ${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p><strong>Qualification:</strong> ${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p><strong>Registration No:</strong> ${doctor.registrationNo}</p>` : ''}
              ${doctor?.phone ? `<p><strong>Phone:</strong> ${doctor.phone}</p>` : ''}
            </div>
          </div>

          <h3>BILL DETAILS</h3>
          <table>
            <thead>
              <tr>
                <th>S.No</th>
                <th>Item Description</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Unit Price (₹)</th>
                <th>Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${bill.billItems.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${item.itemName}</td>
                  <td style="text-transform: capitalize;">${item.itemType}</td>
                  <td style="text-align: center;">${item.quantity}</td>
                  <td style="text-align: right;">${item.unitPrice.toFixed(2)}</td>
                  <td style="text-align: right;">${item.totalPrice.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="summary">
            <div><span>Total Amount:</span> <span>₹${bill.totalAmount.toFixed(2)}</span></div>
            <div><span>Paid Amount:</span> <span style="color: #28a745;">₹${bill.paidAmount.toFixed(2)}</span></div>
            <div class="total"><span>Balance Due:</span> <span style="color: ${bill.balanceAmount > 0 ? '#dc3545' : '#28a745'};">₹${bill.balanceAmount.toFixed(2)}</span></div>
            ${bill.paymentMethod ? `<div><span>Payment Method:</span> <span style="text-transform: capitalize;">${bill.paymentMethod}</span></div>` : ''}
          </div>

          ${bill.notes ? `
          <div style="margin-top: 20px;">
            <h3>NOTES</h3>
            <p style="border: 1px solid #eee; padding: 10px; border-radius: 5px;">${bill.notes}</p>
          </div>
          ` : ''}

          <div class="footer">
            <p>This is a computer-generated bill and does not require a signature.</p>
            <p>Generated on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}</p>
            ${clinicSettings.taxId ? `<p>Tax ID: ${clinicSettings.taxId}</p>` : ''}
          </div>
        </body>
        </html>
      `;
    } else if (type === 'visit') {
      const { visit, patient, doctor, clinicSettings } = data;
      filename = `VisitDetails_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(visit.date).toLocaleDateString('en-IN').replace(/\//g, '-')}.pdf`;
      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Visit Details for ${patient.name}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #333; line-height: 1.4; }
            .header { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; color: #0066FF; }
            .header p { margin: 5px 0; font-size: 12px; }
            .section { margin-bottom: 20px; border: 1px solid #eee; padding: 15px; border-radius: 5px; }
            .section h3 { margin-top: 0; font-size: 16px; color: #0066FF; border-bottom: 1px solid #eee; padding-bottom: 5px; }
            .details-section { display: flex; justify-content: space-between; margin-bottom: 20px; }
            .details-section > div { width: 48%; border: 1px solid #eee; padding: 15px; border-radius: 5px; }
            ul { list-style-type: none; padding: 0; margin: 0; }
            li { margin-bottom: 5px; font-size: 12px; padding: 5px; background-color: #f8f9fa; border-radius: 3px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #eee; padding: 8px; text-align: left; font-size: 12px; }
            th { background-color: #f9f9f9; font-weight: bold; }
            .vitals-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .vital-item { border: 1px solid #eee; padding: 10px; border-radius: 5px; text-align: center; }
            .footer { text-align: center; font-size: 10px; color: #777; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; }
            .signature-section { display: flex; justify-content: space-between; margin-top: 30px; }
            .signature-box { text-align: center; }
            .signature-line { border-bottom: 1px solid #333; width: 150px; margin: 20px auto; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${clinicSettings.clinicName}</h1>
            <p>${clinicSettings.address}</p>
            <p>Phone: ${clinicSettings.phone}${clinicSettings.email ? ` | Email: ${clinicSettings.email}` : ''}</p>
            ${clinicSettings.registrationNumber ? `<p>Registration No: ${clinicSettings.registrationNumber}</p>` : ''}
          </div>

          <div style="text-align: center; margin-bottom: 20px;">
            <h2>PATIENT VISIT DETAILS</h2>
            <p>Visit Date: ${new Date(visit.date).toLocaleDateString('en-IN')} at ${new Date(visit.date).toLocaleTimeString('en-IN')}</p>
          </div>

          <div class="details-section">
            <div>
              <h3>PATIENT DETAILS</h3>
              <p><strong>Name:</strong> ${patient.name}</p>
              <p><strong>Phone:</strong> ${patient.phone}</p>
              <p><strong>Age:</strong> ${patient.age} years</p>
              <p><strong>Gender:</strong> ${patient.gender}</p>
              ${patient.bloodGroup ? `<p><strong>Blood Group:</strong> ${patient.bloodGroup}</p>` : ''}
              <p><strong>Address:</strong> ${patient.address}</p>
              ${patient.allergies && patient.allergies.length > 0 ? `<p><strong>Allergies:</strong> ${patient.allergies.join(', ')}</p>` : ''}
            </div>
            <div>
              <h3>ATTENDING DOCTOR</h3>
              <p><strong>Name:</strong> Dr. ${doctor?.name || 'Not specified'}</p>
              ${doctor?.specialization ? `<p><strong>Specialization:</strong> ${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p><strong>Qualification:</strong> ${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p><strong>Registration No:</strong> ${doctor.registrationNo}</p>` : ''}
              ${doctor?.phone ? `<p><strong>Phone:</strong> ${doctor.phone}</p>` : ''}
            </div>
          </div>

          ${visit.chiefComplaint ? `
          <div class="section">
            <h3>CHIEF COMPLAINT</h3>
            <p>${visit.chiefComplaint}</p>
          </div>
          ` : ''}

          ${Object.values(visit.vitals).some(v => v) ? `
          <div class="section">
            <h3>VITALS</h3>
            <div class="vitals-grid">
              ${visit.vitals.temperature ? `<div class="vital-item"><strong>Temperature</strong><br>${visit.vitals.temperature}°F</div>` : ''}
              ${visit.vitals.bloodPressure ? `<div class="vital-item"><strong>Blood Pressure</strong><br>${visit.vitals.bloodPressure}</div>` : ''}
              ${visit.vitals.pulse ? `<div class="vital-item"><strong>Pulse</strong><br>${visit.vitals.pulse} BPM</div>` : ''}
              ${visit.vitals.weight ? `<div class="vital-item"><strong>Weight</strong><br>${visit.vitals.weight} kg</div>` : ''}
              ${visit.vitals.height ? `<div class="vital-item"><strong>Height</strong><br>${visit.vitals.height} cm</div>` : ''}
              ${visit.vitals.oxygenSaturation ? `<div class="vital-item"><strong>Oxygen Saturation</strong><br>${visit.vitals.oxygenSaturation}%</div>` : ''}
            </div>
          </div>
          ` : ''}

          ${visit.symptoms && visit.symptoms.length > 0 ? `
          <div class="section">
            <h3>SYMPTOMS</h3>
            <ul>
              ${visit.symptoms.map((symptom, index) => `
                <li><strong>${index + 1}. ${symptom.name}</strong>${symptom.severity ? ` (${symptom.severity})` : ''}${symptom.duration ? ` - Duration: ${symptom.duration}` : ''}</li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.diagnoses && visit.diagnoses.length > 0 ? `
          <div class="section">
            <h3>DIAGNOSIS</h3>
            <ul>
              ${visit.diagnoses.map((diagnosis, index) => `
                <li>
                  <strong>${index + 1}. ${diagnosis.name}</strong>${diagnosis.isPrimary ? ' (Primary)' : ''}
                  ${diagnosis.icd10Code ? `<br>ICD-10: ${diagnosis.icd10Code}` : ''}
                  ${diagnosis.notes ? `<br>Notes: ${diagnosis.notes}` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.prescriptions && visit.prescriptions.length > 0 ? `
          <div class="section">
            <h3>PRESCRIPTIONS</h3>
            <table>
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>Frequency</th>
                  <th>Duration</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                ${visit.prescriptions.map((prescription, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td style="font-weight: bold;">${prescription.medicine}</td>
                    <td>${prescription.dosage}</td>
                    <td>${prescription.frequency}</td>
                    <td>${prescription.duration}</td>
                    <td>${prescription.instructions}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${visit.testsOrdered && visit.testsOrdered.length > 0 ? `
          <div class="section">
            <h3>TESTS ORDERED</h3>
            <ul>
              ${visit.testsOrdered.map((test, index) => `
                <li>
                  <strong>${index + 1}. ${test.testName}</strong> (${test.testType} • ${test.urgency})
                  ${test.instructions ? `<br>Instructions: ${test.instructions}` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.advice && visit.advice.length > 0 ? `
          <div class="section">
            <h3>ADVICE</h3>
            <ul>
              ${visit.advice.map(advice => `<li>• ${advice}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.followUpDate ? `
          <div class="section">
            <h3>FOLLOW-UP</h3>
            <p>Next visit scheduled for: <strong>${new Date(visit.followUpDate).toLocaleDateString('en-IN')}</strong></p>
          </div>
          ` : ''}

          ${visit.doctorNotes ? `
          <div class="section">
            <h3>DOCTOR'S NOTES</h3>
            <p style="font-style: italic;">${visit.doctorNotes}</p>
          </div>
          ` : ''}

          <div class="signature-section">
            <div class="signature-box">
              <p><strong>Patient Signature</strong></p>
              <div class="signature-line"></div>
            </div>
            <div class="signature-box">
              <p><strong>Doctor Signature</strong></p>
              <div class="signature-line"></div>
              <p style="font-size: 10px;">Dr. ${doctor?.name || ''}</p>
            </div>
          </div>

          <div class="footer">
            <p>This is a computer-generated visit report.</p>
            <p>Generated on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}</p>
            ${clinicSettings.taxId ? `<p>Tax ID: ${clinicSettings.taxId}</p>` : ''}
          </div>
        </body>
        </html>
      `;
    } else {
      return new Response(
        JSON.stringify({ error: 'Unsupported document type' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Call PDF.co API
    const pdfCoResponse = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
      method: 'POST',
      headers: {
        'x-api-key': pdfCoApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlContent,
        name: filename,
        inline: true,
      }),
    })

    if (!pdfCoResponse.ok) {
      const errorText = await pdfCoResponse.text()
      throw new Error(`PDF.co API Error: ${pdfCoResponse.status} - ${errorText}`)
    }

    const pdfCoData = await pdfCoResponse.json()

    if (!pdfCoData.url) {
      throw new Error('PDF.co did not return a URL for the generated PDF.')
    }

    return new Response(
      JSON.stringify({ success: true, url: pdfCoData.url, filename }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('PDF Generation Edge Function Error:', error)
    return new Response(
      JSON.stringify({
        error: 'Failed to generate PDF',
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})