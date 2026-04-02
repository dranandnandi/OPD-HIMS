import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// Normalizes doctor name: strips any existing Dr./dr. prefix (with or without space)
// then re-adds a clean "Dr. " — handles "Dr.pranav", "Dr. Pranav", "dr. pranav" etc.
const formatDoctorName = (name: string | null | undefined): string => {
  if (!name) return '';
  const cleaned = name.trim().replace(/^dr\.?\s*/i, '').trim();
  return cleaned ? `Dr. ${cleaned}` : '';
}

// Builds a QR code img tag pointing to the prescription verify page
const buildQrHtml = (visitId: string, sizePx = 70): string => {
  const verifyUrl = `https://docpreneur.academy/verify?id=${encodeURIComponent(visitId)}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <img src="${qrSrc}" style="width:${sizePx}px;height:${sizePx}px;display:block;" alt="Scan to verify" />
      <span style="font-size:8px;color:#666;text-align:center;line-height:1.2;">Scan to<br>verify</span>
    </div>
  `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, data, printVersion, compactVersion, forceRegenerate } = await req.json()

    console.log('[PDF GEN] Request received:', {
      type,
      printVersion: printVersion || false,
      compactVersion: compactVersion || false,
      forceRegenerate: forceRegenerate || false
    })

    if (!type || !data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: type and data' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Initialize Supabase Admin Client for checking existing PDFs
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

    // === PDF EXISTENCE CHECK - Return cached PDF if available ===
    if (!forceRegenerate) {
      if (type === 'visit' && data.visit?.id) {
        const column = compactVersion ? 'compact_print_pdf_url' : printVersion ? 'print_pdf_url' : 'pdf_url'
        const { data: existingVisit, error } = await supabaseAdmin
          .from('visits')
          .select(column)
          .eq('id', data.visit.id)
          .single()

        if (!error && existingVisit) {
          const existingPdfUrl = existingVisit[column]

          if (existingPdfUrl) {
            const label = compactVersion ? 'Compact print' : printVersion ? 'Print' : 'Display'
            console.log(`[PDF GEN] ✅ ${label} PDF already exists, returning cached URL:`, existingPdfUrl)
            return new Response(
              JSON.stringify({ success: true, url: existingPdfUrl, cached: true }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
        }
        const label = compactVersion ? 'compact print' : printVersion ? 'print' : 'display'
        console.log(`[PDF GEN] No cached ${label} PDF found, generating new one...`)
      } else if (type === 'bill' && data.bill?.id) {
        const column = printVersion ? 'printPdfUrl' : 'pdfUrl'
        const { data: existingBill, error } = await supabaseAdmin
          .from('bills')
          .select(column)
          .eq('id', data.bill.id)
          .single()

        if (!error && existingBill) {
          const existingPdfUrl = existingBill[column]

          if (existingPdfUrl) {
            console.log(`[PDF GEN] ✅ ${printVersion ? 'Print' : 'Display'} PDF already exists, returning cached URL:`, existingPdfUrl)
            return new Response(
              JSON.stringify({ success: true, url: existingPdfUrl, cached: true }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
        }
        console.log(`[PDF GEN] No cached ${printVersion ? 'print' : 'display'} PDF found, generating new one...`)
      }
    } else {
      console.log('[PDF GEN] Force regenerate enabled: bypassing cache check.')
    }
    // === END PDF EXISTENCE CHECK ===

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

    // Helper to convert image URL to base64 with optimization
    const imageUrlToBase64 = async (url: string): Promise<string> => {
      try {
        // If already base64, return as is
        if (url.startsWith('data:image')) return url;

        let fetchUrl = url;

        // Optimization for ImageKit URLs
        if (url.includes('ik.imagekit.io')) {
          console.log('[PDF GEN] Optimizing ImageKit URL for smaller Base64');
          // If URL already contains a transformation path (tr:...), replace it or append to it
          if (url.includes('/tr:')) {
            // Existing transformation found, replace the specific transformation block
            fetchUrl = url.replace(/\/tr:[^/]+/, '/tr:w-1200,q-75,f-webp');
          } else {
            // No transformation found, insert it after the ID
            const urlParts = url.split('/');
            // Typically: https://ik.imagekit.io/your_id/path/to/image.jpg
            // We want: https://ik.imagekit.io/your_id/tr:w-800,q-70,f-webp/path/to/image.jpg
            if (urlParts.length > 4) {
              urlParts.splice(4, 0, 'tr:w-1200,q-75,f-webp');
              fetchUrl = urlParts.join('/');
            }
          }
        }

        console.log(`[PDF GEN] Fetching image: ${fetchUrl.substring(0, 100)}...`);
        const response = await fetch(fetchUrl);

        // Fallback to original URL if optimized fails
        if (!response.ok && fetchUrl !== url) {
          console.warn(`[PDF GEN] Optimized fetch failed (${response.status}), trying original URL...`);
          const fallbackResponse = await fetch(url);
          if (!fallbackResponse.ok) throw new Error(`Failed to fetch original image: ${fallbackResponse.statusText}`);

          const arrayBuffer = await fallbackResponse.arrayBuffer();
          const base64String = encode(new Uint8Array(arrayBuffer));
          const contentType = fallbackResponse.headers.get('content-type') || 'image/png';
          return `data:${contentType};base64,${base64String}`;
        }

        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

        const arrayBuffer = await response.arrayBuffer();
        const base64String = encode(new Uint8Array(arrayBuffer));
        const contentType = response.headers.get('content-type') || 'image/png';

        console.log(`[PDF GEN] ✅ Image converted to Base64 (${contentType})`);
        return `data:${contentType};base64,${base64String}`;
      } catch (e) {
        console.error('[PDF GEN] ❌ Failed to convert image to base64:', e);
        // Fallback to original URL if conversion fails - PDF.co might still try to fetch it
        return url;
      }
    };


    let htmlContent = '';
    let filename = 'document.pdf';

    // Dynamic HTML Generation based on type
    if (type === 'bill') {
      const { bill, patient, doctor, clinicSettings } = data;
      const consultationItem = bill?.billItems?.find((item: any) =>
        String(item?.itemType || '').toLowerCase() === 'consultation' &&
        typeof item?.itemName === 'string'
      );
      const extractedDoctorName = consultationItem?.itemName?.includes(' - ')
        ? consultationItem.itemName.split(' - ').slice(1).join(' - ').trim()
        : '';
      const resolvedDoctorName = (doctor?.name || bill?.visit?.doctor?.name || extractedDoctorName || '').trim();
      const doctorDisplayName = resolvedDoctorName
        ? (/^dr\.?\s+/i.test(resolvedDoctorName) ? resolvedDoctorName : `Dr. ${resolvedDoctorName}`)
        : '';
      filename = printVersion
        ? `Print_Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
        : `Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Bill #${bill.billNumber}${printVersion ? ' (Print Version)' : ''}</title>
          <style>
            /* === PRINT VERSION STYLING === */
            ${printVersion ? `
            html, body {
              filter: grayscale(100%) !important;
              -webkit-filter: grayscale(100%) !important;
              print-color-adjust: exact !important;
            }
            
            /* Hide headers and footers */
            .custom-header, .custom-footer, .header, .footer {
              display: none !important;
            }
            
            /* Force black text */
            body, p, div, span, h1, h2, h3 {
              color: #000 !important;
            }
            
            /* Remove backgrounds */
            .status, th {
              background: #ddd !important;
              color: #000 !important;
            }
            
            /* Simplify borders */
            .header, .details-section > div, table, th, td {
              border-color: #000 !important;
            }
            ` : ''}
            /* === END PRINT VERSION STYLING === */
            
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
              ${doctorDisplayName ? `<p><strong>Name:</strong> ${doctorDisplayName}</p>` : ''}
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
                <th>Disc (%)</th>
                <th>Tax (%)</th>
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
                  <td style="text-align: center;">${item.discount ? item.discount + '%' : '-'}</td>
                  <td style="text-align: center;">${item.tax ? item.tax + '%' : '-'}</td>
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

        </body>
        </html>
      `;
    } else if (type === 'visit' && compactVersion) {
      // =====================================================
      // COMPACT PRINT VERSION - 1 page, tight layout
      // =====================================================
      const { visit, patient, doctor } = data;
      filename = `CompactRx_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(visit.date).toLocaleDateString('en-IN').replace(/\//g, '-')}.pdf`;

      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Prescription - ${patient.name}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: Arial, sans-serif;
              font-size: 11px;
              color: #000;
              line-height: 1.35;
              padding: 12px 16px;
            }
            .top-bar {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #000;
              padding-bottom: 6px;
              margin-bottom: 8px;
            }
            .top-bar .rx { font-size: 20px; font-weight: bold; }
            .top-bar .date { font-size: 10px; text-align: right; }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 6px;
              margin-bottom: 8px;
              border: 1px solid #888;
              border-radius: 3px;
              padding: 6px;
            }
            .info-col p { margin-bottom: 2px; }
            .info-col strong { font-size: 10px; text-transform: uppercase; color: #444; }
            .section-title {
              font-size: 10px;
              font-weight: bold;
              text-transform: uppercase;
              background: #e8e8e8;
              padding: 2px 6px;
              margin: 6px 0 4px;
              border-left: 3px solid #000;
            }
            .compact-line {
              margin-bottom: 3px;
              padding-left: 4px;
            }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
            th {
              background: #333;
              color: #fff;
              font-size: 10px;
              padding: 3px 5px;
              text-align: left;
              font-weight: bold;
            }
            td { font-size: 10px; padding: 3px 5px; border-bottom: 1px solid #ddd; vertical-align: top; }
            tr:nth-child(even) td { background: #f5f5f5; }
            .followup {
              border: 1px dashed #000;
              padding: 4px 8px;
              margin: 6px 0;
              font-size: 11px;
            }
            .advice-list { padding-left: 12px; }
            .advice-list li { margin-bottom: 2px; }
            .sig-row {
              display: flex;
              justify-content: space-between;
              margin-top: 10px;
              border-top: 1px solid #000;
              padding-top: 6px;
            }
            .sig-box { text-align: center; width: 45%; }
            .sig-line { border-bottom: 1px solid #000; margin-bottom: 3px; height: 20px; }
            .allergy-warn {
              background: #ffeeee;
              border: 1px solid #cc0000;
              padding: 3px 6px;
              margin-bottom: 6px;
              font-size: 10px;
              font-weight: bold;
              color: #cc0000;
            }
          </style>
        </head>
        <body>

          <div class="top-bar">
            <div>
              <div style="font-size:12px; font-weight:bold; margin-bottom:4px;">${data.clinicSettings?.clinicName || 'Clinic'}</div>
            </div>
            <div class="date">
              Date & Time: <strong>${new Date(visit.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}</strong>
            </div>
          </div>

          <!-- PATIENT / DOCTOR INFO -->
          <div class="info-grid">
            <div class="info-col">
              <p><strong>Patient</strong></p>
              <p><b>${patient.name}</b></p>
              <p>${patient.age ? patient.age + ' yrs' : ''} ${patient.gender ? '| ' + patient.gender : ''} ${patient.bloodGroup ? '| ' + patient.bloodGroup : ''}</p>
              <p>Ph: ${patient.phone || 'N/A'}</p>
              ${patient.address ? `<p>${patient.address}</p>` : ''}
            </div>
            <div class="info-col">
              <p><strong>Doctor</strong></p>
              <p><b>${formatDoctorName(doctor?.name || 'N/A')}</b></p>
              ${doctor?.specialization ? `<p>${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p>${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p>Reg: ${doctor.registrationNo}</p>` : ''}
            </div>
          </div>

          ${patient.allergies && patient.allergies.length > 0 ? `
          <div class="allergy-warn">&#9888; ALLERGIES: ${patient.allergies.join(', ')}</div>
          ` : ''}

          ${visit.chiefComplaint ? `
          <div class="section-title">Chief Complaint</div>
          <div class="compact-line">${visit.chiefComplaint}</div>
          ` : ''}

          ${visit.symptoms && visit.symptoms.length > 0 ? `
          <div class="section-title">Symptoms</div>
          <div class="compact-line">
            ${visit.symptoms.map(s => s.name + (s.severity ? ' (' + s.severity + ')' : '') + (s.duration ? ' - ' + s.duration : '')).join(' &nbsp;|&nbsp; ')}
          </div>
          ` : ''}

          ${visit.diagnoses && visit.diagnoses.length > 0 ? `
          <div class="section-title">Diagnosis</div>
          <div class="compact-line">
            ${visit.diagnoses.map((d, i) => (i + 1) + '. ' + d.name + (d.isPrimary ? ' (Primary)' : '')).join(' &nbsp;&nbsp; ')}
          </div>
          ` : ''}

          ${visit.prescriptions && visit.prescriptions.length > 0 ? `
          <div class="section-title">Medications</div>
          <table>
            <thead>
              <tr>
                <th style="width:22px;">#</th>
                <th>Medicine</th>
                <th style="width:60px;">Dosage</th>
                <th style="width:80px;">Frequency</th>
                <th style="width:55px;">Duration</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              ${visit.prescriptions.map((p, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><b>${p.medicine}</b></td>
                <td>${p.dosage || '-'}</td>
                <td>${p.frequency || '-'}</td>
                <td>${p.duration || '-'}</td>
                <td>${p.instructions || '-'}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="font-size:9px; color:#555; margin-bottom:4px;">* Take medications as prescribed. Contact doctor if side effects occur.</div>
          ` : ''}

          ${visit.testsOrdered && visit.testsOrdered.length > 0 ? `
          <div class="section-title">Tests Ordered</div>
          <div class="compact-line">
            ${visit.testsOrdered.map((t, i) => (i + 1) + '. ' + t.testName + (t.urgency === 'urgent' ? ' [URGENT]' : '')).join(' &nbsp;&nbsp; ')}
          </div>
          ` : ''}

          ${visit.advice && visit.advice.length > 0 ? `
          <div class="section-title">Advice</div>
          <ul class="advice-list">
            ${visit.advice.map(a => `<li>${a}</li>`).join('')}
          </ul>
          ` : ''}

          ${visit.followUpDate ? `
          <div class="followup">
            <b>Follow-up:</b> ${new Date(visit.followUpDate).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
          ` : ''}

          <!-- SIGNATURES -->
          <div class="sig-row">
            ${visit.id ? buildQrHtml(visit.id, 60) : ''}
            <div class="sig-box">
              <div class="sig-line"></div>
              <div>${patient.name}</div>
              <div style="font-size:9px;">Patient Signature</div>
            </div>
            <div class="sig-box">
              <div class="sig-line"></div>
              <div>${formatDoctorName(doctor?.name || '')}</div>
              <div style="font-size:9px;">Dr. Signature ${doctor?.registrationNo ? '| Reg: ' + doctor.registrationNo : ''}</div>
            </div>
          </div>

        </body>
        </html>
      `;
    } else if (type === 'visit') {
      const { visit, patient, doctor, clinicSettings } = data;
      filename = `VisitDetails_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(visit.date).toLocaleDateString('en-IN').replace(/\//g, '-')}.pdf`;

      // Get Gemini API key for translation
      const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY');

      // Determine if we need regional language (support both camelCase and snake_case)
      const adviceLanguage = visit.adviceLanguage || visit.advice_language || 'english';
      const visitAdviceRegional = visit.adviceRegional || visit.advice_regional || '';
      const isRegionalLanguage = adviceLanguage !== 'english';

      // Debug logging
      console.log('Advice Language Fields:', {
        adviceLanguage_camelCase: visit.adviceLanguage,
        advice_language_snake: visit.advice_language,
        adviceRegional_camelCase: visit.adviceRegional,
        advice_regional_snake: visit.advice_regional,
        resolved_language: adviceLanguage,
        resolved_regional: visitAdviceRegional,
        isRegionalLanguage
      });

      // Language names map for prompts
      const languageNames: Record<string, string> = {
        'hindi': 'Hindi (हिंदी)',
        'bengali': 'Bengali (বাংলা)',
        'gujarati': 'Gujarati (ગુજરાતી)',
        'tamil': 'Tamil (தமிழ்)',
        'telugu': 'Telugu (తెలుగు)',
        'kannada': 'Kannada (ಕನ್ನಡ)',
        'malayalam': 'Malayalam (മലയാളം)',
        'marathi': 'Marathi (मराठी)',
        'punjabi': 'Punjabi (ਪੰਜਾਬੀ)',
        'oriya': 'Oriya (ଓଡ଼ିଆ)'
      };

      // AI Translation function
      const translateWithAI = async (content: {
        advice?: string[],
        diagnoses?: string[],
        prescriptions?: Array<{ medicine: string, dosage?: string, frequency?: string, duration?: string, instructions?: string }>
      }, targetLanguage: string): Promise<{
        translatedAdvice: string,
        translatedDiagnoses: Array<{ original: string, translated: string }>,
        translatedPrescriptions: Array<{ medicine: string, instructions: string }>
      }> => {
        if (!geminiApiKey || targetLanguage === 'english') {
          return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
        }

        try {
          const prompt = `You are a medical translator. Translate the following medical advice and prescription instructions to ${languageNames[targetLanguage] || targetLanguage}.

IMPORTANT RULES:
1. Keep medical terms accurate
2. Use simple, patient-friendly language
3. Maintain the meaning precisely
4. Output ONLY valid JSON, no explanation

INPUT:
${JSON.stringify({
            advice: content.advice || [],
            diagnoses: content.diagnoses || [],
            prescriptions: content.prescriptions?.map(p => ({
              medicine: p.medicine,
              instructions: p.instructions || '',
              frequency: p.frequency || '',
              duration: p.duration || ''
            })) || []
          }, null, 2)}

OUTPUT JSON FORMAT:
{
  "translatedAdvice": "All advice combined in ${targetLanguage} as a single paragraph, using bullet points (•) to separate items",
  "translatedDiagnoses": [
    {
      "original": "Original diagnosis name in English",
      "translated": "Translated diagnosis name in ${targetLanguage}"
    }
  ],
  "translatedPrescriptions": [
    {
      "medicine": "Original medicine name (keep in English)",
      "instructions": "Translated instructions including frequency, duration, and special instructions in ${targetLanguage}"
    }
  ]
}

Translate now:`;

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.3,
                  maxOutputTokens: 2048,
                }
              })
            }
          );

          if (!response.ok) {
            console.error('Gemini translation failed:', await response.text());
            return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
          }

          const result = await response.json();
          const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

          // Extract JSON from response
          const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
              translatedAdvice: parsed.translatedAdvice || '',
              translatedDiagnoses: parsed.translatedDiagnoses || [],
              translatedPrescriptions: parsed.translatedPrescriptions || []
            };
          }

          return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
        } catch (error) {
          console.error('Translation error:', error);
          return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
        }
      };

      // Perform AI translation if regional language is selected
      let aiTranslation = { translatedAdvice: '', translatedDiagnoses: [] as Array<{ original: string, translated: string }>, translatedPrescriptions: [] as Array<{ medicine: string, instructions: string }> };

      // Helper to check if text contains non-English characters (Hindi, Gujarati, etc.)
      const isAlreadyRegionalText = (text: string): boolean => {
        if (!text) return false;
        // Check for Devanagari (Hindi, Marathi), Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Oriya scripts
        const regionalPattern = /[\u0900-\u097F\u0A80-\u0AFF\u0980-\u09FF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0A00-\u0A7F]/;
        return regionalPattern.test(text);
      };

      // Translate if regional language selected AND (there's content to translate OR regional advice is in English)
      const needsTranslation = isRegionalLanguage && (
        // Translate advice if it exists and isn't already in regional script
        (visit.advice?.length > 0) ||
        // Translate diagnoses if they exist
        (visit.diagnoses?.length > 0) ||
        // Translate prescriptions if they exist
        (visit.prescriptions?.length > 0) ||
        // Translate regional advice if it's in English (not already regional script)
        (visitAdviceRegional && !isAlreadyRegionalText(visitAdviceRegional))
      );

      // Track original English text for showing both in PDF
      let originalAdviceText = '';
      if (visitAdviceRegional && !isAlreadyRegionalText(visitAdviceRegional)) {
        originalAdviceText = visitAdviceRegional; // Store original English
      }

      if (needsTranslation) {
        console.log(`Translating content to ${adviceLanguage}...`);

        // Include regional advice for translation if it's in English
        const adviceToTranslate = [...(visit.advice || [])];
        if (visitAdviceRegional && !isAlreadyRegionalText(visitAdviceRegional)) {
          adviceToTranslate.push(visitAdviceRegional); // Add the English regional advice for translation
        }

        aiTranslation = await translateWithAI({
          advice: adviceToTranslate,
          diagnoses: visit.diagnoses?.map(d => d.name) || [],
          prescriptions: visit.prescriptions
        }, adviceLanguage);
        console.log('Translation complete:', aiTranslation.translatedAdvice ? 'Success' : 'No translation');
      }

      // Use AI translation if available, otherwise use manual regional advice
      // If regional advice was in English and we translated it, it's now in the translatedAdvice
      const regionalAdviceText = aiTranslation.translatedAdvice || visitAdviceRegional;

      // Helper function to format frequency codes to patient-friendly text
      const formatFrequency = (freq: string): string => {
        const freqMap: Record<string, string> = {
          'OD': 'Once Daily',
          'BD': 'Twice Daily (Morning & Evening)',
          'TDS': 'Three Times Daily',
          'QID': 'Four Times Daily',
          'QDS': 'Four Times Daily',
          'HS': 'At Bedtime',
          'SOS': 'As Needed',
          'PRN': 'As Needed',
          'STAT': 'Immediately',
          'AC': 'Before Meals',
          'PC': 'After Meals',
          'CC': 'With Meals',
          'BBF': 'Before Breakfast',
          'ABF': 'After Breakfast'
        };
        return freqMap[freq?.toUpperCase()] || freq;
      };

      // Helper function to format timing instructions with AI translation fallback
      const formatInstructions = (instructions: string, medicineName?: string): string => {
        if (!instructions) return '';

        // Check if we have AI-translated instructions for this medicine
        if (isRegionalLanguage && medicineName && aiTranslation.translatedPrescriptions.length > 0) {
          const translated = aiTranslation.translatedPrescriptions.find(
            p => p.medicine.toLowerCase() === medicineName.toLowerCase()
          );
          if (translated?.instructions) {
            return translated.instructions;
          }
        }

        // Language-specific instruction translations
        const instrByLanguage: Record<string, Record<string, string>> = {
          'hindi': {
            'before food': '🍽️ Take BEFORE meals (खाने से पहले)',
            'after food': '🍽️ Take AFTER meals (खाने के बाद)',
            'with food': '🍽️ Take WITH meals (खाने के साथ)',
            'before meal': '🍽️ Take BEFORE meals (खाने से पहले)',
            'after meal': '🍽️ Take AFTER meals (खाने के बाद)',
            'empty stomach': '⏰ On EMPTY stomach (खाली पेट)',
            'morning': '🌅 Morning (सुबह)',
            'evening': '🌆 Evening (शाम)',
            'night': '🌙 Night/Before bed (रात को)',
            'bedtime': '🌙 Before bed (सोने से पहले)'
          },
          'gujarati': {
            'before food': '🍽️ Take BEFORE meals (જમતા પહેલા)',
            'after food': '🍽️ Take AFTER meals (જમ્યા પછી)',
            'with food': '🍽️ Take WITH meals (જમવાની સાથે)',
            'before meal': '🍽️ Take BEFORE meals (જમતા પહેલા)',
            'after meal': '🍽️ Take AFTER meals (જમ્યા પછી)',
            'empty stomach': '⏰ On EMPTY stomach (ખાલી પેટે)',
            'morning': '🌅 Morning (સવારે)',
            'evening': '🌆 Evening (સાંજે)',
            'night': '🌙 Night/Before bed (રાત્રે)',
            'bedtime': '🌙 Before bed (સૂતા પહેલા)'
          },
          'bengali': {
            'before food': '🍽️ Take BEFORE meals (খাওয়ার আগে)',
            'after food': '🍽️ Take AFTER meals (খাওয়ার পরে)',
            'with food': '🍽️ Take WITH meals (খাওয়ার সাথে)',
            'before meal': '🍽️ Take BEFORE meals (খাওয়ার আগে)',
            'after meal': '🍽️ Take AFTER meals (খাওয়ার পরে)',
            'empty stomach': '⏰ On EMPTY stomach (খালি পেটে)',
            'morning': '🌅 Morning (সকালে)',
            'evening': '🌆 Evening (সন্ধ্যায়)',
            'night': '🌙 Night/Before bed (রাতে)',
            'bedtime': '🌙 Before bed (ঘুমানোর আগে)'
          },
          'marathi': {
            'before food': '🍽️ Take BEFORE meals (जेवणापूर्वी)',
            'after food': '🍽️ Take AFTER meals (जेवणानंतर)',
            'with food': '🍽️ Take WITH meals (जेवणासोबत)',
            'before meal': '🍽️ Take BEFORE meals (जेवणापूर्वी)',
            'after meal': '🍽️ Take AFTER meals (जेवणानंतर)',
            'empty stomach': '⏰ On EMPTY stomach (रिकाम्या पोटी)',
            'morning': '🌅 Morning (सकाळी)',
            'evening': '🌆 Evening (संध्याकाळी)',
            'night': '🌙 Night/Before bed (रात्री)',
            'bedtime': '🌙 Before bed (झोपण्यापूर्वी)'
          },
          'tamil': {
            'before food': '🍽️ Take BEFORE meals (சாப்பிடுவதற்கு முன்)',
            'after food': '🍽️ Take AFTER meals (சாப்பிட்ட பின்)',
            'with food': '🍽️ Take WITH meals (உணவுடன்)',
            'empty stomach': '⏰ On EMPTY stomach (வெறும் வயிற்றில்)',
            'morning': '🌅 Morning (காலை)',
            'evening': '🌆 Evening (மாலை)',
            'night': '🌙 Night/Before bed (இரவு)',
            'bedtime': '🌙 Before bed (தூங்குவதற்கு முன்)'
          },
          'telugu': {
            'before food': '🍽️ Take BEFORE meals (భోజనానికి ముందు)',
            'after food': '🍽️ Take AFTER meals (భోజనం తర్వాత)',
            'with food': '🍽️ Take WITH meals (భోజనంతో)',
            'empty stomach': '⏰ On EMPTY stomach (ఖాళీ కడుపుతో)',
            'morning': '🌅 Morning (ఉదయం)',
            'evening': '🌆 Evening (సాయంత్రం)',
            'night': '🌙 Night/Before bed (రాత్రి)',
            'bedtime': '🌙 Before bed (నిద్రకు ముందు)'
          }
        };

        // Get language-specific map or fallback to Hindi
        const instrMap = instrByLanguage[adviceLanguage] || instrByLanguage['hindi'] || {};

        let result = instructions;
        Object.entries(instrMap).forEach(([key, val]) => {
          if (instructions.toLowerCase().includes(key)) {
            result = val;
          }
        });
        return result;
      };

      htmlContent = `
        <!DOCTYPE html>
        <html lang="${adviceLanguage === 'hindi' ? 'hi' : adviceLanguage === 'bengali' ? 'bn' : 'en'}">
        <head>
          <meta charset="UTF-8">
          <title>Visit Details for ${patient.name}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Gujarati:wght@400;700&family=Noto+Sans+Gurmukhi:wght@400;700&family=Noto+Sans+Kannada:wght@400;700&family=Noto+Sans+Malayalam:wght@400;700&family=Noto+Sans+Oriya:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Telugu:wght@400;700&display=swap" rel="stylesheet">
          <style>
            /* === PRINT VERSION STYLING === */
            ${printVersion ? `
            html, body {
              filter: grayscale(100%) !important;
              -webkit-filter: grayscale(100%) !important;
              print-color-adjust: exact !important;
              -webkit-print-color-adjust: exact !important;
            }
            
            /* Hide headers and footers for letterhead */
            .custom-header, .custom-footer, .header, .footer, .prescription-header {
              display: none !important;
            }
            
            /* Force black text for readability */
            body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6 {
              color: #000 !important;
            }
            
            /* Remove colored backgrounds */
            .section, .details-section > div, .vital-item, .patient-friendly-instr,
            .regional-advice, .warning-box, .signature-section {
              background: white !important;
            }
            
            /* Simplify borders to black */
            .header, .section, .details-section > div, table, th, td {
              border-color: #000 !important;
            }
            
            /* Remove gradients from table headers */
            th {
              background: #ddd !important;
              color: #000 !important;
            }

            /* === COMPACT SPACING: reduce gaps between components === */
            body { margin: 10px !important; line-height: 1.4 !important; }
            .section { margin-bottom: 8px !important; padding: 8px 10px !important; }
            .section h3 { padding-bottom: 4px !important; margin-bottom: 6px !important; font-size: 13px !important; }
            .details-section { margin-bottom: 8px !important; gap: 8px !important; }
            .details-section > div { padding: 8px 10px !important; }
            .details-section h3 { padding-bottom: 4px !important; margin-bottom: 4px !important; }
            .details-section p { margin: 2px 0 !important; }
            li { margin-bottom: 4px !important; padding: 5px 8px !important; }
            th, td { padding: 5px 6px !important; }
            .vitals-grid { gap: 6px !important; }
            .vital-item { padding: 6px 8px !important; }
            .vital-value { font-size: 15px !important; }
            .patient-friendly-instr { margin-top: 4px !important; padding: 4px 8px !important; }
            .regional-advice { margin-top: 6px !important; padding: 8px 10px !important; }
            .warning-box { margin-top: 4px !important; padding: 5px 8px !important; }
            .signature-section { margin-top: 16px !important; padding: 10px 16px !important; }
            .signature-line { margin: 16px auto 6px !important; }
            table { margin-top: 4px !important; }
            ` : ''}
            /* === END PRINT VERSION STYLING === */
            
            * { box-sizing: border-box; }
            body { 
              font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Gujarati', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Kannada', 'Noto Sans Malayalam', 'Noto Sans Oriya', 'Noto Sans Gurmukhi', Arial, sans-serif; 
              margin: 20px; 
              color: #333; 
              line-height: 1.6; 
              font-size: 14px;
            }
            .hindi-text { font-family: 'Noto Sans Devanagari', sans-serif; }
            .bengali-text { font-family: 'Noto Sans Bengali', sans-serif; }
            .gujarati-text { font-family: 'Noto Sans Gujarati', sans-serif; }
            .tamil-text { font-family: 'Noto Sans Tamil', sans-serif; }
            .telugu-text { font-family: 'Noto Sans Telugu', sans-serif; }
            .kannada-text { font-family: 'Noto Sans Kannada', sans-serif; }
            .malayalam-text { font-family: 'Noto Sans Malayalam', sans-serif; }
            .oriya-text { font-family: 'Noto Sans Oriya', sans-serif; }
            .punjabi-text { font-family: 'Noto Sans Gurmukhi', sans-serif; }
            .header { text-align: center; border-bottom: 3px solid #0066FF; padding-bottom: 20px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 26px; color: #0066FF; }
            .header p { margin: 5px 0; font-size: 12px; color: #666; }
            .prescription-header { background: linear-gradient(135deg, #0066FF 0%, #00AA55 100%); color: white; padding: 15px; text-align: center; margin: 20px 0; border-radius: 8px; }
            .prescription-header h2 { margin: 0; font-size: 20px; }
            .section { margin-bottom: 20px; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; background: #fafafa; }
            .section h3 { margin-top: 0; font-size: 16px; color: #0066FF; border-bottom: 2px solid #0066FF; padding-bottom: 8px; display: flex; align-items: center; gap: 8px; }
            .section-icon { font-size: 18px; }
            .details-section { display: flex; justify-content: space-between; margin-bottom: 20px; gap: 15px; }
            .details-section > div { flex: 1; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; background: white; }
            .details-section h3 { margin-top: 0; font-size: 14px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 8px; }
            ul { list-style-type: none; padding: 0; margin: 0; }
            li { margin-bottom: 8px; font-size: 13px; padding: 10px; background-color: white; border-radius: 5px; border-left: 3px solid #0066FF; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ddd; padding: 12px 8px; text-align: left; font-size: 13px; }
            th { background: linear-gradient(135deg, #0066FF 0%, #0088FF 100%); color: white; font-weight: 600; }
            tr:nth-child(even) { background-color: #f8f9fa; }
            tr:hover { background-color: #e9f5ff; }
            .vitals-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
            .vital-item { border: 1px solid #e0e0e0; padding: 12px; border-radius: 8px; text-align: center; background: white; }
            .vital-item strong { color: #0066FF; font-size: 12px; display: block; margin-bottom: 5px; }
            .vital-value { font-size: 18px; font-weight: bold; color: #333; }
            .footer { text-align: center; font-size: 10px; color: #999; margin-top: 30px; border-top: 2px solid #eee; padding-top: 15px; }
            .signature-section { display: flex; justify-content: space-between; margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
            .signature-box { text-align: center; width: 200px; }
            .signature-line { border-bottom: 2px solid #333; width: 150px; margin: 30px auto 10px; }
            .rx-symbol { font-size: 28px; font-weight: bold; color: #0066FF; margin-right: 10px; }
            .medicine-name { font-weight: bold; color: #0066FF; font-size: 14px; }
            .timing-badge { display: inline-block; background: #fff3cd; color: #856404; padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-top: 5px; }
            .patient-friendly-instr { background: #e8f5e9; padding: 8px 12px; border-radius: 5px; margin-top: 8px; font-size: 12px; color: #2e7d32; }
            .regional-advice { margin-top: 15px; padding: 15px; background: #fff8e1; border-radius: 8px; border-left: 4px solid #ff9800; }
            .regional-advice h4 { margin: 0 0 10px 0; color: #e65100; font-size: 14px; }
            .warning-box { background: #ffebee; border: 1px solid #ef5350; border-radius: 5px; padding: 10px; margin-top: 10px; }
            .warning-box p { margin: 0; color: #c62828; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="prescription-header">
            <h2>📋 PATIENT PRESCRIPTION</h2>
            <p style="margin: 5px 0; font-size: 12px;">Visit Date & Time: ${new Date(visit.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}</p>
          </div>

          <div class="details-section">
            <div>
              <h3>👤 PATIENT DETAILS</h3>
              <p><strong>Name:</strong> ${patient.name}</p>
              <p><strong>Phone:</strong> ${patient.phone}</p>
              <p><strong>Age:</strong> ${patient.age} years | <strong>Gender:</strong> ${patient.gender}</p>
              ${patient.bloodGroup ? `<p><strong>Blood Group:</strong> ${patient.bloodGroup}</p>` : ''}
              <p><strong>Address:</strong> ${patient.address}</p>
              ${patient.allergies && patient.allergies.length > 0 ? `
                <div class="warning-box">
                  <p>⚠️ <strong>ALLERGIES:</strong> ${patient.allergies.join(', ')}</p>
                </div>
              ` : ''}
            </div>
            <div>
              <h3>👨‍⚕️ ATTENDING DOCTOR</h3>
              <p><strong>Name:</strong> ${formatDoctorName(doctor?.name || 'Not specified')}</p>
              ${doctor?.specialization ? `<p><strong>Specialization:</strong> ${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p><strong>Qualification:</strong> ${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p><strong>Registration No:</strong> ${doctor.registrationNo}</p>` : ''}
              ${doctor?.phone ? `<p><strong>Phone:</strong> ${doctor.phone}</p>` : ''}
            </div>
          </div>

          ${visit.chiefComplaint ? `
          <div class="section">
            <h3><span class="section-icon">📝</span> CHIEF COMPLAINT</h3>
            <p style="font-size: 15px; font-weight: 500;">${visit.chiefComplaint}</p>
          </div>
          ` : ''}

          ${Object.values(visit.vitals || {}).some(v => v) ? `
          <div class="section">
            <h3><span class="section-icon">💓</span> VITALS</h3>
            <div class="vitals-grid">
              ${visit.vitals.temperature ? `<div class="vital-item"><strong>🌡️ Temperature</strong><span class="vital-value">${visit.vitals.temperature}°F</span></div>` : ''}
              ${visit.vitals.bloodPressure ? `<div class="vital-item"><strong>🩸 Blood Pressure</strong><span class="vital-value">${visit.vitals.bloodPressure}</span></div>` : ''}
              ${visit.vitals.pulse ? `<div class="vital-item"><strong>❤️ Pulse</strong><span class="vital-value">${visit.vitals.pulse} BPM</span></div>` : ''}
              ${visit.vitals.weight ? `<div class="vital-item"><strong>⚖️ Weight</strong><span class="vital-value">${visit.vitals.weight} kg</span></div>` : ''}
              ${visit.vitals.height ? `<div class="vital-item"><strong>📏 Height</strong><span class="vital-value">${visit.vitals.height} cm</span></div>` : ''}
              ${visit.vitals.oxygenSaturation ? `<div class="vital-item"><strong>🫁 SpO2</strong><span class="vital-value">${visit.vitals.oxygenSaturation}%</span></div>` : ''}
            </div>
          </div>
          ` : ''}

          ${visit.physicalExamination?.sections && visit.physicalExamination.sections.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🔍</span> PHYSICAL EXAMINATION</h3>
            ${visit.physicalExamination.sections.map(section => `
              <div style="margin-bottom: 15px;">
                <h4 style="font-size: 13px; color: #666; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">${section.title}</h4>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                  ${section.fields.filter(f => f.value).map(field => `
                    <div style="background: white; padding: 8px; border-radius: 4px; border: 1px solid #eee;">
                      <p style="font-size: 10px; color: #666; margin: 0 0 3px 0;">${field.label}</p>
                      <p style="font-size: 12px; font-weight: bold; margin: 0;">${typeof field.value === 'boolean' ? (field.value ? '✓ Present' : '✗ Absent') : field.value}</p>
                    </div>
                  `).join('')}
                </div>
                ${section.fields.filter(f => f.value).length === 0 ? '<p style="color: #999; font-size: 11px; font-style: italic;">No findings recorded</p>' : ''}
              </div>
            `).join('')}
          </div>
          ` : ''}

          ${visit.symptoms && visit.symptoms.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🤒</span> SYMPTOMS</h3>
            <ul>
              ${visit.symptoms.map((symptom, index) => `
                <li>
                  <strong>${index + 1}. ${symptom.name}</strong>
                  ${symptom.severity ? ` <span style="background: ${symptom.severity === 'severe' ? '#ffcdd2' : symptom.severity === 'moderate' ? '#fff9c4' : '#c8e6c9'}; padding: 2px 8px; border-radius: 3px; font-size: 11px;">${symptom.severity}</span>` : ''}
                  ${symptom.duration ? ` - Duration: ${symptom.duration}` : ''}
                  ${symptom.notes ? `<br><em style="color: #666; font-size: 12px;">${symptom.notes}</em>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.diagnoses && visit.diagnoses.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🏥</span> DIAGNOSIS</h3>
            <ul>
              ${visit.diagnoses.map((diagnosis, index) => {
        // Find translation if available
        let displayName = diagnosis.name;
        if (isRegionalLanguage && aiTranslation.translatedDiagnoses.length > 0) {
          const translated = aiTranslation.translatedDiagnoses.find(
            d => d.original.toLowerCase() === diagnosis.name.toLowerCase()
          );
          if (translated?.translated) {
            displayName = `${diagnosis.name} <span class="hindi-text" style="color: #666; font-size: 0.9em;">(${translated.translated})</span>`;
          }
        }

        return `
                <li>
                  <strong>${index + 1}. ${displayName}</strong>
                  ${diagnosis.isPrimary ? ' <span style="background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 3px; font-size: 11px;">Primary</span>' : ''}
                  ${diagnosis.icd10Code ? `<br><span style="color: #666; font-size: 11px;">ICD-10: ${diagnosis.icd10Code}</span>` : ''}
                  ${diagnosis.notes ? `<br><em style="color: #666; font-size: 12px;">${diagnosis.notes}</em>` : ''}
                </li>
              `}).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.prescriptions && visit.prescriptions.length > 0 ? `
          <div class="section" style="border: 2px solid #0066FF;">
            <h3><span class="rx-symbol">℞</span> MEDICATIONS</h3>
            <table>
              <thead>
                <tr>
                  <th style="width: 30px;">#</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>When to Take</th>
                  <th>Duration</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                ${visit.prescriptions.map((prescription, index) => `
                  <tr>
                    <td style="text-align: center; font-weight: bold;">${index + 1}</td>
                    <td>
                      <span class="medicine-name">${prescription.medicine}</span>
                    </td>
                    <td>${prescription.dosage || '-'}</td>
                    <td>
                      <strong>${formatFrequency(prescription.frequency)}</strong>
                    </td>
                    <td>${prescription.duration || '-'}</td>
                    <td>
                      ${prescription.instructions ? `<div class="patient-friendly-instr">${formatInstructions(prescription.instructions, prescription.medicine)}</div>` : '-'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div style="margin-top: 15px; padding: 12px; background: #e3f2fd; border-radius: 5px;">
              <p style="margin: 0; font-size: 12px; color: #1565c0;">
                <strong>📌 Important:</strong> Take medications as prescribed. Consult your doctor if you experience any side effects.
              </p>
            </div>
          </div>
          ` : ''}

          ${visit.testsOrdered && visit.testsOrdered.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🧪</span> TESTS ORDERED</h3>
            <ul>
              ${visit.testsOrdered.map((test, index) => `
                <li>
                  <strong>${index + 1}. ${test.testName}</strong>
                  <span style="background: ${test.urgency === 'urgent' ? '#ffcdd2' : '#e8f5e9'}; color: ${test.urgency === 'urgent' ? '#c62828' : '#2e7d32'}; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 8px;">${test.urgency || 'Routine'}</span>
                  <span style="color: #666; font-size: 11px; margin-left: 8px;">(${test.testType})</span>
                  ${test.instructions ? `<br><em style="color: #666; font-size: 12px;">→ ${test.instructions}</em>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${(visit.advice && visit.advice.length > 0) || regionalAdviceText ? `
          <div class="section" style="background: #f0f7ff;">
            <h3><span class="section-icon">💡</span> ADVICE FOR PATIENT</h3>
            ${visit.advice && visit.advice.length > 0 ? `
            <ul>
              ${visit.advice.map(advice => `<li style="border-left-color: #4caf50;">✓ ${advice}</li>`).join('')}
            </ul>
            ` : ''}
            ${originalAdviceText && regionalAdviceText && originalAdviceText !== regionalAdviceText ? `
            <div style="background: #f5f5f5; padding: 10px 15px; border-radius: 5px; margin-bottom: 10px; border-left: 3px solid #9e9e9e;">
              <p style="margin: 0; font-size: 12px; color: #666;">
                <strong>📝 Original (English):</strong> ${originalAdviceText}
              </p>
            </div>
            ` : ''}
            ${regionalAdviceText ? `
            <div class="regional-advice ${adviceLanguage === 'hindi' ? 'hindi-text' : adviceLanguage === 'bengali' ? 'bengali-text' : adviceLanguage === 'gujarati' ? 'gujarati-text' : adviceLanguage === 'tamil' ? 'tamil-text' : adviceLanguage === 'telugu' ? 'telugu-text' : adviceLanguage === 'marathi' ? 'hindi-text' : adviceLanguage === 'kannada' ? 'kannada-text' : adviceLanguage === 'malayalam' ? 'malayalam-text' : adviceLanguage === 'oriya' ? 'oriya-text' : adviceLanguage === 'punjabi' ? 'punjabi-text' : ''}">
              <h4>🗣️ ${adviceLanguage.charAt(0).toUpperCase() + adviceLanguage.slice(1)} Translation</h4>
              <p style="font-size: 14px; line-height: 1.8;">${regionalAdviceText}</p>
            </div>
            ` : ''}
          </div>
          ` : ''}

          ${visit.followUpDate ? `
          <div class="section" style="background: #fff3e0;">
            <h3><span class="section-icon">📅</span> FOLLOW-UP APPOINTMENT</h3>
            <p style="font-size: 16px; font-weight: bold; color: #e65100;">
              Please visit again on: <span style="background: #ff9800; color: white; padding: 5px 15px; border-radius: 5px;">${new Date(visit.followUpDate).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </p>
          </div>
          ` : ''}

          ${visit.doctorNotes ? `
          <div class="section">
            <h3><span class="section-icon">📋</span> DOCTOR'S NOTES</h3>
            <p style="font-style: italic; color: #555; background: white; padding: 12px; border-radius: 5px; border-left: 3px solid #9c27b0;">${visit.doctorNotes}</p>
          </div>
          ` : ''}

          <div class="signature-section">
            <div style="display:flex;align-items:flex-end;gap:16px;">
              ${visit.id ? buildQrHtml(visit.id, 65) : ''}
              <div class="signature-box">
                <p><strong>Patient Signature</strong></p>
                <div class="signature-line"></div>
                <p style="font-size: 10px; color: #666;">${patient.name}</p>
              </div>
            </div>
            <div class="signature-box">
              <p><strong>Doctor's Signature</strong></p>
              <div class="signature-line"></div>
              <p style="font-size: 10px; color: #666;">${formatDoctorName(doctor?.name || '')}</p>
              ${doctor?.registrationNo ? `<p style="font-size: 9px; color: #999;">Reg: ${doctor.registrationNo}</p>` : ''}
            </div>
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

    // Get clinic PDF margins (default to letterhead margins for print, regular for display)
    const hasCustomDisplayMargins = Boolean(data.clinicSettings?.pdfMargins);


    // Prepare header/footer for PDF.co (only for display version)
    // Convert to Base64 because some URLs might be private
    let pdfHeader = "";
    let pdfFooter = "";
    let fallbackHeaderFooterUsed = false;
    const hasHeaderImage = Boolean(data.clinicSettings?.pdfHeaderUrl);
    const hasFooterImage = Boolean(data.clinicSettings?.pdfFooterUrl);

    if (!printVersion && !compactVersion) {
      if (data.clinicSettings?.pdfHeaderUrl) {
        const headerBase64 = await imageUrlToBase64(data.clinicSettings.pdfHeaderUrl);
        pdfHeader = `<div style="width: 100%; text-align: center; margin: 0; padding: 0;"><img src="${headerBase64}" style="width: 100%; height: auto; display: block;" /></div>`;
      } else {
        fallbackHeaderFooterUsed = true;
        const clinicName = escapeHtml(data.clinicSettings?.clinicName || 'Clinic');
        const clinicAddress = escapeHtml(data.clinicSettings?.address || '');
        const clinicPhone = escapeHtml(data.clinicSettings?.phone || '');
        const clinicEmail = escapeHtml(data.clinicSettings?.email || '');
        const regNumber = escapeHtml(data.clinicSettings?.registrationNumber || '');
        pdfHeader = `
          <div style="width: 100%; padding: 8px 16px 6px; border-bottom: 1px solid #d1d5db; font-family: Arial, sans-serif; color: #111827;">
            <div style="font-size: 16px; font-weight: 700; line-height: 1.2;">${clinicName}</div>
            <div style="font-size: 10px; line-height: 1.35; margin-top: 2px;">
              ${clinicAddress ? `<div>${clinicAddress}</div>` : ''}
              ${(clinicPhone || clinicEmail || regNumber) ? `<div>${[clinicPhone ? `Phone: ${clinicPhone}` : '', clinicEmail ? `Email: ${clinicEmail}` : '', regNumber ? `Reg: ${regNumber}` : ''].filter(Boolean).join(' | ')}</div>` : ''}
            </div>
          </div>
        `;
      }

      if (data.clinicSettings?.pdfFooterUrl) {
        const footerBase64 = await imageUrlToBase64(data.clinicSettings.pdfFooterUrl);
        pdfFooter = `<div style="width: 100%; text-align: center; margin: 0; padding: 0;"><img src="${footerBase64}" style="width: 100%; height: auto; display: block;" /></div>`;
      } else {
        fallbackHeaderFooterUsed = true;
        const website = escapeHtml(data.clinicSettings?.website || '');
        const taxId = escapeHtml(data.clinicSettings?.taxId || '');
        const clinicName = escapeHtml(data.clinicSettings?.clinicName || 'Clinic');
        pdfFooter = `
          <div style="width: 100%; padding: 6px 16px; border-top: 1px solid #d1d5db; font-family: Arial, sans-serif; color: #4b5563; font-size: 10px; line-height: 1.3; text-align: center;">
            <div>${clinicName}${website ? ` | ${website}` : ''}${taxId ? ` | Tax ID: ${taxId}` : ''}</div>
            <div style="font-size: 9px; color: #6b7280;">This is a computer-generated medical document.</div>
          </div>
        `;
      }
    }

    const clinicMargins = (compactVersion || printVersion)
      ? (data.clinicSettings?.pdfPrintMargins || "180px 20px 150px 20px")  // Same letterhead margins for both compact and print
      : (hasCustomDisplayMargins
        ? data.clinicSettings?.pdfMargins
        : (fallbackHeaderFooterUsed ? "70px 20px 55px 20px" : "20px"));

    console.log(`[PDF GEN] Calling PDF.co with ${printVersion ? 'PRINT' : 'DISPLAY'} settings...`);
    console.log(`[PDF GEN] Header: ${pdfHeader ? 'Base64 image included' : 'None'}`);
    console.log(`[PDF GEN] Footer: ${pdfFooter ? 'Base64 image included' : 'None'}`);
    if (pdfHeader) console.log(`[PDF GEN] Header length: ${pdfHeader.length} chars`);
    if (pdfFooter) console.log(`[PDF GEN] Footer length: ${pdfFooter.length} chars`);


    // Call PDF.co API with proper parameters
    const pdfCoResponse = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
      method: 'POST',
      headers: {
        'x-api-key': pdfCoApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: filename,
        html: htmlContent,
        async: true,
        margins: clinicMargins,
        papersize: "A4",
        displayheaderfooter: !printVersion && !compactVersion, // No header/footer for print or compact
        header: pdfHeader,
        footer: pdfFooter,
        headerheight: (printVersion || compactVersion) ? "0px" : (hasHeaderImage ? "120px" : "58px"),
        footerheight: (printVersion || compactVersion) ? "0px" : (hasFooterImage ? "80px" : "42px"),
        scale: 1,
        mediatype: "print",
        printbackground: !printVersion, // Colors only for display version
      }),
    })

    if (!pdfCoResponse.ok) {
      const errorText = await pdfCoResponse.text()
      throw new Error(`PDF.co API Error: ${pdfCoResponse.status} - ${errorText}`)
    }

    const pdfCoData = await pdfCoResponse.json()
    console.log(`[PDF GEN] PDF.co initial response:`, JSON.stringify(pdfCoData));

    let pdfUrl: string | null = null;

    // Handle synchronous response - URL returned directly (like LIMS app)
    if (pdfCoData.url && pdfCoData.error === false) {
      console.log(`[PDF GEN] ✅ PDF generated synchronously!`);
      pdfUrl = pdfCoData.url;
    }
    // Handle async response - need to poll for completion
    else if (pdfCoData.jobId) {
      console.log(`[PDF GEN] PDF.co async job started: ${pdfCoData.jobId}`);

      // --- Poll PDF.co job status until complete ---
      const PDFCO_JOB_STATUS_URL = 'https://api.pdf.co/v1/job/check';
      const maxPollAttempts = 60; // 60 attempts = ~2 minutes max
      const pollInterval = 2000; // 2 seconds

      for (let pollAttempt = 1; pollAttempt <= maxPollAttempts; pollAttempt++) {
        console.log(`[PDF GEN] Polling job status (attempt ${pollAttempt}/${maxPollAttempts})...`);

        try {
          const statusResponse = await fetch(`${PDFCO_JOB_STATUS_URL}?jobid=${pdfCoData.jobId}`, {
            method: 'GET',
            headers: {
              'x-api-key': pdfCoApiKey,
            }
          });

          if (!statusResponse.ok) {
            throw new Error(`Job status check failed: ${statusResponse.status}`);
          }

          const statusData = await statusResponse.json();
          console.log(`[PDF GEN] Job status:`, JSON.stringify(statusData));

          // Check for success (polling returns status: "success")
          if (statusData.status === 'success' && statusData.url) {
            pdfUrl = statusData.url;
            console.log(`[PDF GEN] ✅ Job complete! PDF URL: ${pdfUrl}`);
            break;
          } else if (statusData.status === 'error' || statusData.status === 'failed') {
            throw new Error(`PDF.co job failed: ${statusData.message || 'Unknown error'}`);
          }

          // Job still processing, wait before next poll
          if (pollAttempt < maxPollAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }

        } catch (error) {
          console.error(`[PDF GEN] Polling error:`, error);
          if (pollAttempt >= maxPollAttempts) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }
    } else {
      throw new Error('PDF.co did not return a URL or jobId');
    }

    if (!pdfUrl) {
      throw new Error('PDF.co job did not complete within timeout period (2 minutes)');
    }

    // --- Reliability Logic: Verify file availability before returning (Avoid "Broken" PDF) ---
    // This addresses the issue where PDF.co returns a URL but the file is not yet available on S3
    console.log(`[PDF GEN] ⏳ Applying safety delay (3s) for file stabilization...`);
    await new Promise(r => setTimeout(r, 3000));

    let isFileActuallyReady = false;
    const verificationAttempts = 10;
    console.log(`[PDF GEN] Verifying file availability at: ${pdfUrl}`);

    for (let i = 1; i <= verificationAttempts; i++) {
      try {
        console.log(`[PDF GEN] Polling job status (attempt ${i})...`);
        const checkRes = await fetch(pdfUrl);
        const contentType = checkRes.headers.get('content-type');

        if (checkRes.ok && contentType && contentType.includes('application/pdf')) {
          isFileActuallyReady = true;
          console.log(`[PDF GEN] ✅ Job status: success (verified at attempt ${i})`);
          break;
        }
        console.warn(`[PDF GEN] Job status: pending (Attempt ${i}/10 - Status: ${checkRes.status}, Content: ${contentType})`);
      } catch (e) {
        console.error(`[PDF GEN] Job status: failed (Attempt ${i}):`, e.message);
      }

      if (i < verificationAttempts) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!isFileActuallyReady) {
      console.error('[PDF GEN] Job status: failed (Verification timed out after 10 attempts)');
      // If verification fails, we throw an error so the user knows to retry instead of getting a broken tab
      throw new Error('PDF file failed to stabilize on PDF.co servers. Please try again in a few seconds.');
    }

    // --- Return temp URL only after verification passes ---
    console.log('[PDF GEN] ✅ Returning verified URL to user');

    // Background persistence task
    const persistToStorage = async () => {
      try {
        console.log('[PDF GEN] Background: Waiting 6s for S3...');
        await new Promise(resolve => setTimeout(resolve, 6000));

        let pdfBlob: Blob | null = null;
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`[PDF GEN] Background: Download ${attempt}/${maxRetries}...`);
            const res = await fetch(pdfUrl!);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            pdfBlob = await res.blob();
            if (pdfBlob.size === 0) throw new Error('Empty');
            console.log(`[PDF GEN] Background: ✅ Downloaded (${pdfBlob.size} bytes)`);
            break;
          } catch (e) {
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }

        if (!pdfBlob) {
          console.error('[PDF GEN] Background: ❌ Download failed');
          return;
        }

        const bucketName = 'pdfs';
        let storagePath = '';
        if (type === 'bill' && data.bill?.id) {
          storagePath = `bills/${data.bill.id}/${printVersion ? 'print' : 'display'}/${filename}`;
        } else if (type === 'visit' && data.visit?.id) {
          if (compactVersion) {
            storagePath = `visits/${data.visit.id}/compact/${filename}`;
          } else {
            storagePath = `visits/${data.visit.id}/${printVersion ? 'print' : 'display'}/${filename}`;
          }
        } else {
          storagePath = `temp/${crypto.randomUUID()}/${filename}`;
        }

        const { error: uploadError } = await supabaseAdmin.storage
          .from(bucketName)
          .upload(storagePath, pdfBlob, { contentType: 'application/pdf', upsert: true });

        if (uploadError) {
          console.error('[PDF GEN] Background: ❌ Upload failed:', uploadError.message);
          return;
        }

        const { data: { publicUrl } } = supabaseAdmin.storage.from(bucketName).getPublicUrl(storagePath);
        console.log('[PDF GEN] Background: ✅ Persisted:', publicUrl);

        const table = type === 'bill' ? 'bills' : 'visits';
        const recordId = type === 'bill' ? data.bill?.id : data.visit?.id;
        if (recordId) {
          const column = compactVersion
            ? 'compact_print_pdf_url'
            : printVersion
              ? (type === 'bill' ? 'printPdfUrl' : 'print_pdf_url')
              : (type === 'bill' ? 'pdfUrl' : 'pdf_url');
          await supabaseAdmin.from(table).update({ [column]: publicUrl }).eq('id', recordId);
          console.log('[PDF GEN] Background: ✅ DB updated with column:', column);
        }
      } catch (err) {
        console.error('[PDF GEN] Background error:', err);
      }
    };

    // Start background task (fire and forget)
    persistToStorage().catch(e => console.error('[PDF GEN] Background task error:', e));

    // Return temp URL immediately
    return new Response(
      JSON.stringify({
        success: true,
        url: pdfUrl,
        filename,
        temporary: true,
        message: 'PDF ready! Storage sync in progress...'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('PDF Generation Edge Function Error:', error)
    return new Response(
      JSON.stringify({
        error: 'Failed to generate PDF',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
