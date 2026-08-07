// Patient document-upload portal (public, unauthenticated).
//
// A patient opens a link like /patient-upload?c=<upload_link_id> and uploads
// documents (ID card, insurance policy, OPD paper, external reports) for
// TPA/insurance. This function is the trust boundary: it validates the
// patient-specific link id, then writes to the PRIVATE 'patient-documents'
// bucket using the service role. No login, no expiring token — the link id is a
// stable random UUID that maps to exactly one patient.
//
// Same public-page + service-role pattern as verify-prescription.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { decode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_DOC_TYPES = ['id_card', 'insurance_policy', 'opd_paper', 'external_report', 'other'];
const ALLOWED_CONTENT = /^(image\/(jpeg|jpg|png|heic|heif|webp)|application\/pdf)$/i;
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload = await req.json();
    const { action, code } = payload;
    if (!code || typeof code !== 'string') return json({ error: 'Missing link code' }, 400);

    // Resolve the patient from the shareable link id.
    const { data: patient, error: pErr } = await supabase
      .from('patients')
      .select('id, name, clinic_id, is_hidden, clinic:clinic_settings!patients_clinic_id_fkey(clinic_name)')
      .eq('upload_link_id', code)
      .maybeSingle();

    if (pErr) return json({ error: 'Lookup failed' }, 500);
    if (!patient || patient.is_hidden) return json({ status: 'not_found' }, 200);

    // --- info: what the public page shows before uploading --------------------
    if (action === 'info') {
      return json({
        status: 'ok',
        patientName: patient.name ?? '',
        clinicName: (patient.clinic as { clinic_name?: string } | null)?.clinic_name ?? '',
      });
    }

    // --- upload: store one file ----------------------------------------------
    if (action === 'upload') {
      const { docType, fileName, contentType, fileBase64, admissionId } = payload;

      if (!fileBase64 || typeof fileBase64 !== 'string') return json({ error: 'No file' }, 400);
      if (!ALLOWED_CONTENT.test(String(contentType ?? ''))) {
        return json({ error: 'Only images and PDF files are allowed' }, 400);
      }
      const type = ALLOWED_DOC_TYPES.includes(docType) ? docType : 'other';

      // strip any data-URL prefix, then decode
      const b64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '');
      let bytes: Uint8Array;
      try {
        bytes = decode(b64);
      } catch {
        return json({ error: 'Invalid file data' }, 400);
      }
      if (bytes.length === 0) return json({ error: 'Empty file' }, 400);
      if (bytes.length > MAX_BYTES) return json({ error: 'File too large (max 15 MB)' }, 400);

      const safeName = (fileName ?? 'document').toString().replace(/[^\w.-]/g, '_').slice(-80);
      const storagePath = `${patient.clinic_id}/${patient.id}/${crypto.randomUUID()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from('patient-documents')
        .upload(storagePath, bytes, { contentType: String(contentType), upsert: false });
      if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

      const { error: insErr } = await supabase.from('patient_uploaded_documents').insert({
        clinic_id: patient.clinic_id,
        patient_id: patient.id,
        admission_id: admissionId ?? null,
        doc_type: type,
        file_name: safeName,
        storage_path: storagePath,
        content_type: String(contentType),
        size_bytes: bytes.length,
        source: 'patient_portal',
      });
      if (insErr) return json({ error: `Save failed: ${insErr.message}` }, 500);

      return json({ status: 'ok' });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('patient-upload error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
