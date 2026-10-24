import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { authorizeClinic, buildBotDraft, validateBotSettings, type ClinicContext } from '../_shared/opd-bot.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hims-bot-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || !['get', 'tune', 'save'].includes(body.action || 'get')) return json({ error: 'Invalid action' }, 400);
    const action = body.action || 'get';
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    let clinicId: string;
    let canSave = false;
    const suppliedSecret = req.headers.get('x-hims-bot-secret');
    if (suppliedSecret !== null) {
      const expected = Deno.env.get('HIMS_BOT_SECRET');
      if (!expected || suppliedSecret !== expected) return json({ error: 'Unauthorized' }, 401);
      // Trusted WhatsApp backend derives this ID from its authenticated user's mapping.
      clinicId = body.clinicId;
      canSave = true;
    } else {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'Authentication required' }, 401);
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: 'Authentication required' }, 401);
      const { data: profile, error: profileError } = await admin.from('profiles').select('clinic_id, role_name, is_active').eq('id', data.user.id).maybeSingle();
      if (profileError) throw new Error('Could not verify clinic membership');
      try { clinicId = authorizeClinic(profile, body.clinicId, action === 'save'); }
      catch (err) { return json({ error: (err as Error).message }, 403); }
      canSave = ['admin', 'super_admin'].includes(profile?.role_name || '');
    }
    if (typeof clinicId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(clinicId)) return json({ error: 'Valid clinic ID required' }, 400);
    const { data: clinic, error: clinicError } = await admin.from('clinic_settings').select('id, clinic_name, address, phone, timezone, working_hours').eq('id', clinicId).maybeSingle();
    if (clinicError) throw new Error('Could not load clinic details');
    if (!clinic) return json({ error: 'Clinic not found' }, 404);
    const doctors: ClinicContext['doctors'] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin.from('profiles').select('id, name, specialization, qualification, doctor_availability, consultation_fee').eq('clinic_id', clinicId).eq('is_active', true).eq('is_open_for_consultation', true).order('name').order('id').range(offset, offset + 499);
      if (error) throw new Error('Could not load consultation doctors');
      for (const d of data || []) doctors.push({ id: d.id, name: d.name, specialization: d.specialization, qualification: d.qualification, availability: d.doctor_availability, consultationFee: d.consultation_fee });
      if (!data || data.length < 500) break;
    }
    const context: ClinicContext = { clinic: { id: clinic.id, name: clinic.clinic_name || 'our clinic', address: clinic.address || '', phone: clinic.phone || '', timezone: clinic.timezone || 'Asia/Kolkata', workingHours: clinic.working_hours }, doctors, specialties: [...new Set(doctors.map(d => d.specialization?.trim()).filter((s): s is string => !!s))].sort() };
    const draft = buildBotDraft(context);
    let settings;
    let updatedAt: string | null = null;
    if (action === 'save') {
      try { settings = validateBotSettings(body.settings); } catch (err) { return json({ error: (err as Error).message }, 400); }
      const { data, error } = await admin.from('opd_bot_settings').upsert({ clinic_id: clinicId, settings, updated_at: new Date().toISOString() }, { onConflict: 'clinic_id' }).select('updated_at').single();
      if (error) throw new Error('Could not save OPD bot settings');
      updatedAt = data.updated_at;
    } else {
      const { data, error } = await admin.from('opd_bot_settings').select('settings, updated_at').eq('clinic_id', clinicId).maybeSingle();
      if (error) throw new Error('Could not load OPD bot settings');
      settings = data?.settings || null;
      updatedAt = data?.updated_at || null;
    }
    return json({ context, draft, settings, updatedAt, canSave, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[hims-opd-bot]', (err as Error).message);
    return json({ error: (err as Error).message || 'Could not load OPD bot details' }, 500);
  }
});
