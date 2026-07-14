// IPD server-side PDF generation — same pipeline as the OPD app's
// generate-pdf-from-html: HTML → PDF.co (async job) → verified temp URL
// returned immediately → background persist to the 'pdfs' storage bucket →
// permanent URL written to ipd_bills.pdf_url / ipd_documents.pdf_url.
// Header/footer images + margins come from clinic_settings (same as OPD).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const escapeHtml = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function imageUrlToBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') ?? 'image/png';
    return `data:${contentType};base64,${encode(new Uint8Array(buf))}`;
  } catch {
    return url;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // auth: signed-in users only
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error('Invalid authentication');

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const pdfCoApiKey = Deno.env.get('PDFCO_API_KEY');
    if (!pdfCoApiKey) throw new Error('PDFCO_API_KEY secret not configured');

    // docType: 'ipd_bill' | 'ipd_document'; recordId targets the pdf_url update
    const { html, docType, recordId, clinicId, filename, forceRegenerate } = await req.json();
    if (!html || !docType || !recordId || !clinicId) {
      throw new Error('html, docType, recordId and clinicId are required');
    }
    const table = docType === 'ipd_bill' ? 'ipd_bills' : 'ipd_documents';
    const safeName = (filename ?? `${docType}-${recordId}.pdf`).replace(/[^\w.-]/g, '_');

    // cached?
    if (!forceRegenerate) {
      const { data: existing } = await supabaseAdmin
        .from(table).select('pdf_url').eq('id', recordId).single();
      if (existing?.pdf_url) {
        return new Response(
          JSON.stringify({ success: true, url: existing.pdf_url, cached: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // clinic header/footer + margins (same fields the OPD app uses)
    const { data: clinic } = await supabaseAdmin
      .from('clinic_settings')
      .select('clinic_name, address, phone, email, website, registration_number, tax_id, pdf_header_url, pdf_footer_url, pdf_margins')
      .eq('id', clinicId)
      .single();

    let pdfHeader = '';
    let pdfFooter = '';
    let fallback = false;
    if (clinic?.pdf_header_url) {
      const b64 = await imageUrlToBase64(clinic.pdf_header_url);
      pdfHeader = `<div style="width:100%;text-align:center;margin:0;padding:0;"><img src="${b64}" style="width:100%;height:auto;display:block;" /></div>`;
    } else {
      fallback = true;
      pdfHeader = `
        <div style="width:100%;padding:8px 16px 6px;border-bottom:1px solid #d1d5db;font-family:Arial,sans-serif;color:#111827;">
          <div style="font-size:16px;font-weight:700;">${escapeHtml(clinic?.clinic_name || 'Hospital')}</div>
          <div style="font-size:10px;line-height:1.25;">
            ${clinic?.address ? `<div>${escapeHtml(clinic.address)}</div>` : ''}
            <div>${[clinic?.phone ? `Phone: ${escapeHtml(clinic.phone)}` : '', clinic?.email ? `Email: ${escapeHtml(clinic.email)}` : '', clinic?.registration_number ? `Reg: ${escapeHtml(clinic.registration_number)}` : ''].filter(Boolean).join(' | ')}</div>
          </div>
        </div>`;
    }
    if (clinic?.pdf_footer_url) {
      const b64 = await imageUrlToBase64(clinic.pdf_footer_url);
      pdfFooter = `<div style="width:100%;text-align:center;margin:0;padding:0;"><img src="${b64}" style="width:100%;height:auto;display:block;" /></div>`;
    } else {
      fallback = true;
      pdfFooter = `
        <div style="width:100%;padding:6px 16px;border-top:1px solid #d1d5db;font-family:Arial,sans-serif;color:#4b5563;font-size:10px;text-align:center;">
          <div>${escapeHtml(clinic?.clinic_name || '')}${clinic?.website ? ` | ${escapeHtml(clinic.website)}` : ''}${clinic?.tax_id ? ` | Tax ID: ${escapeHtml(clinic.tax_id)}` : ''}</div>
          <div style="font-size:9px;color:#6b7280;">Computer-generated document — Inpatient Department</div>
        </div>`;
    }
    const margins = clinic?.pdf_margins || (fallback ? '70px 20px 55px 20px' : '120px 20px 80px 20px');

    // --- PDF.co async job -----------------------------------------------------
    const startRes = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
      method: 'POST',
      headers: { 'x-api-key': pdfCoApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: safeName,
        html,
        async: true,
        margins,
        papersize: 'A4',
        displayheaderfooter: true,
        header: pdfHeader,
        footer: pdfFooter,
        headerheight: clinic?.pdf_header_url ? '120px' : '58px',
        footerheight: clinic?.pdf_footer_url ? '80px' : '42px',
        scale: 1,
        mediatype: 'print',
        printbackground: true,
      }),
    });
    if (!startRes.ok) throw new Error(`PDF.co error ${startRes.status}: ${await startRes.text()}`);
    const startData = await startRes.json();

    let pdfUrl: string | null = null;
    if (startData.url && startData.error === false && !startData.jobId) {
      pdfUrl = startData.url;
    } else if (startData.jobId) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const st = await fetch('https://api.pdf.co/v1/job/check', {
          method: 'POST',
          headers: { 'x-api-key': pdfCoApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobid: startData.jobId }),
        });
        const stData = await st.json();
        if (stData.status === 'success') { pdfUrl = stData.url; break; }
        if (stData.status === 'failed' || stData.status === 'aborted') {
          throw new Error(`PDF.co job failed: ${stData.message ?? 'unknown'}`);
        }
      }
    }
    if (!pdfUrl) throw new Error('PDF.co did not return a URL within timeout');

    // verify the file is fetchable before returning it
    for (let i = 0; i < 5; i++) {
      const head = await fetch(pdfUrl, { method: 'HEAD' });
      if (head.ok) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    // --- background: persist to storage + save permanent URL -------------------
    const persist = async () => {
      try {
        await new Promise((r) => setTimeout(r, 6000));
        let blob: Blob | null = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const res = await fetch(pdfUrl!);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            blob = await res.blob();
            if (blob.size === 0) throw new Error('empty');
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
        if (!blob) return;

        const storagePath = `ipd/${docType}/${recordId}/${safeName}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from('pdfs')
          .upload(storagePath, blob, { contentType: 'application/pdf', upsert: true });
        if (upErr) { console.error('persist upload failed:', upErr.message); return; }

        const { data: { publicUrl } } = supabaseAdmin.storage.from('pdfs').getPublicUrl(storagePath);
        await supabaseAdmin.from(table)
          .update({ pdf_url: publicUrl, ...(docType === 'ipd_document' ? { generated_at: new Date().toISOString() } : {}) })
          .eq('id', recordId);
        console.log('persisted:', publicUrl);
      } catch (e) {
        console.error('persist error:', e);
      }
    };
    persist().catch((e) => console.error('bg error:', e));

    return new Response(
      JSON.stringify({ success: true, url: pdfUrl, temporary: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('generate-ipd-pdf error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
