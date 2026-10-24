import { useEffect, useState } from 'react';
import { RefreshCw, Save, Stethoscope } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import type { BotSettings, ClinicContext } from '../../../supabase/functions/_shared/opd-bot';

const languages = ['English', 'Hindi', 'Gujarati', 'Marathi', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Punjabi'];
interface BotResponse { context: ClinicContext; settings: BotSettings | null; draft: BotSettings; canSave: boolean; updatedAt: string | null }

export default function OPDBotSettings() {
  const { user } = useAuth();
  const [details, setDetails] = useState<BotResponse | null>(null);
  const [form, setForm] = useState<BotSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function request(action: string, settings?: BotSettings): Promise<BotResponse> {
    if (!supabase) throw new Error('Please sign in to HIMS first');
    const { data, error } = await supabase.functions.invoke('hims-opd-bot', { body: { action, settings } });
    if (error) {
      const response = error.context;
      const body = response instanceof Response ? await response.json().catch(() => null) : null;
      throw new Error(body?.error || 'Could not load OPD bot settings. Please retry.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    setDetails(null); setForm(null); setMessage(''); setError(''); setBusy(true);
    request('get').then(data => {
      if (!cancelled) { setDetails(data); setForm(data.settings || data.draft); }
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  async function run(action: 'tune' | 'save') {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await request(action, action === 'save' && form ? form : undefined);
      setDetails(data);
      setForm(action === 'tune' ? { ...data.draft, allowedLanguages: form?.allowedLanguages || data.draft.allowedLanguages } : data.settings || data.draft);
      setMessage(action === 'tune' ? 'Draft refreshed from HIMS. Review the greeting and instructions, then save.' : 'Saved for this clinic in HIMS and the WhatsApp OPD bot.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update OPD bot'); }
    finally { setBusy(false); }
  }

  return <section className="bg-white rounded-xl border p-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold text-lg flex items-center gap-2"><Stethoscope size={20} /> OPD Bot Settings</h3>
        <p className="text-sm text-gray-600">Welcome patients with your clinic name, consultation doctors and specialties.</p></div>
      <button type="button" onClick={() => run('tune')} disabled={busy} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50">
        <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> {busy ? 'Loading…' : 'Tune from HIMS'}
      </button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="text-sm text-green-700">{message}</p>}
    {details && <div className="rounded-lg bg-blue-50 p-3 text-sm space-y-1">
      <p className="font-semibold">{details.context.clinic.name}</p>
      <p>{details.context.doctors.length} doctors open for consultation · {details.context.specialties.join(', ') || 'No specialties listed'}</p>
      <p className="text-gray-600">Appointment slots are checked live. Weekly hours do not guarantee availability.</p>
      {!details.canSave && <p>Ask a clinic administrator to save changes.</p>}
    </div>}
    {form && <fieldset disabled={busy || !details?.canSave} className="space-y-4 disabled:opacity-70">
      <label className="block text-sm font-medium">Greeting message
        <textarea rows={8} value={form.greetingMessage} onChange={e => setForm({ ...form, greetingMessage: e.target.value })} className="mt-1 block w-full rounded-lg border p-3 font-normal" />
      </label>
      <label className="block text-sm font-medium">Reception / contact number
        <input value={form.contactNumber} onChange={e => setForm({ ...form, contactNumber: e.target.value })} className="mt-1 block w-full rounded-lg border p-3 font-normal" />
      </label>
      <div><p className="text-sm font-medium mb-2">Supported languages (choose 1 to 3)</p><div className="flex flex-wrap gap-3">
        {languages.map(language => <label key={language} className="text-sm flex items-center gap-1"><input type="checkbox" checked={form.allowedLanguages.includes(language)} disabled={!form.allowedLanguages.includes(language) && form.allowedLanguages.length >= 3} onChange={e => {
          const next = e.target.checked ? [...form.allowedLanguages, language] : form.allowedLanguages.filter(l => l !== language);
          if (next.length) setForm({ ...form, allowedLanguages: next });
        }} />{language}</label>)}
      </div></div>
      <label className="block text-sm font-medium">System instructions
        <textarea rows={12} value={form.systemPrompt} onChange={e => setForm({ ...form, systemPrompt: e.target.value })} className="mt-1 block w-full rounded-lg border p-3 font-normal" />
      </label>
      <p className="text-xs text-gray-600">Saving updates the shared clinic settings used by both apps. Tuning replaces this draft; it takes effect only after saving.</p>
      <button type="button" onClick={() => run('save')} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"><Save size={16} /> Save OPD Bot Settings</button>
    </fieldset>}
  </section>;
}
