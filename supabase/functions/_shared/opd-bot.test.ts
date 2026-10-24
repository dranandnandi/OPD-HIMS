import { authorizeClinic, buildBotDraft, validateBotSettings, type ClinicContext } from './opd-bot.ts';

const context: ClinicContext = { clinic: { id: 'clinic-a', name: 'Sunrise Clinic', address: '', phone: '12345', timezone: 'Asia/Kolkata', workingHours: null }, doctors: [
  { id: 'a', name: 'Amit', specialization: 'Cardiology', qualification: 'MD', availability: null, consultationFee: null },
  { id: 'b', name: 'Dr. Bina', specialization: 'Dermatology', qualification: null, availability: null, consultationFee: 0 },
], specialties: ['Cardiology', 'Dermatology'] };
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function throws(fn: () => unknown) { let threw = false; try { fn(); } catch { threw = true; } assert(threw); }
Deno.test('greeting includes clinic, every consultation doctor and specialties without duplicated Dr', () => {
  const draft = buildBotDraft(context);
  for (const text of ['Sunrise Clinic', 'Dr. Amit', 'Dr. Bina', 'Cardiology', 'Dermatology', '12345']) assert(draft.greetingMessage.includes(text), text);
  assert(!draft.greetingMessage.includes('Dr. Dr.'));
  assert(draft.systemPrompt.includes('check live slots'));
  assert(draft.systemPrompt.includes('Confirm the doctor'));
  assert(validateBotSettings(draft).greetingMessage === draft.greetingMessage);
});
Deno.test('no doctors sends reception fallback without inventing availability', () => {
  const draft = buildBotDraft({ ...context, doctors: [], specialties: [] });
  assert(draft.greetingMessage.includes('contact reception'));
  assert(!draft.greetingMessage.includes('Doctors open for consultation'));
});
Deno.test('settings reject invalid languages, oversized prompts and wrong types', () => {
  const draft = buildBotDraft(context);
  throws(() => validateBotSettings({ ...draft, allowedLanguages: [] }));
  throws(() => validateBotSettings({ ...draft, allowedLanguages: ['English', 'English'] }));
  throws(() => validateBotSettings({ ...draft, allowedLanguages: ['Unknown'] }));
  throws(() => validateBotSettings({ ...draft, systemPrompt: 'x'.repeat(100001) }));
  throws(() => validateBotSettings({ ...draft, greetingMessage: {} }));
});
Deno.test('browser cannot read another clinic or save without administrator role', () => {
  const profile = { clinic_id: 'clinic-a', role_name: 'admin', is_active: true };
  assert(authorizeClinic(profile, undefined, true) === 'clinic-a');
  throws(() => authorizeClinic(profile, 'clinic-b', false));
  throws(() => authorizeClinic({ ...profile, is_active: false }, undefined, false));
  throws(() => authorizeClinic({ ...profile, role_name: 'receptionist' }, undefined, true));
});
