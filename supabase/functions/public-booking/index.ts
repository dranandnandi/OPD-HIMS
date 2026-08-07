// Public appointment self-booking (Phase 1, no OTP).
//
// A patient opens https://opdapp.anprohealthtech.com/book/<slug> (or the vanity
// form https://docpreneur.academy/<slug>/appointment, a proxy rewrite to the
// same route), picks a doctor and a free slot, types their name and phone, and
// gets an appointment. No login anywhere in the flow.
//
// This function is the entire trust boundary. The public page holds no Supabase
// client and never touches a table; every read is shaped here so that a URL
// alone can't be turned into a patient-lookup oracle or a clinic directory.
// Same public-page + service-role pattern as `patient-upload` and
// `verify-prescription`.
//
// Phase 1 has no OTP, so a phone number is unverified at booking time. Three
// things carry the load instead: bookings land as 'Scheduled' (not 'Confirmed')
// for reception to vet, per-IP and per-phone rate limits throttle bulk abuse,
// and `booking_source = 'public'` marks every row so staff can see what came in
// off the street.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import {
  addDaysToKey,
  BusyInterval,
  clinicDayRangeUtc,
  dateKeyInZone,
  formatInZone,
  generateFreeSlots,
  parseDateKey,
  todayInZone,
  WeeklyAvailability,
} from '../_shared/slots.ts';

// Wide open: the booking page is meant to be embedded as a widget on arbitrary
// clinic websites, so the origin is not knowable ahead of time.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_DURATION_MINUTES = 30;

// Statuses that occupy a slot. Cancelled / No_Show / Completed free it up.
const BLOCKING_STATUSES = ['Scheduled', 'Confirmed', 'Arrived', 'In_Progress'];

const POLICY_DEFAULTS = {
  leadTimeHours: 2,
  horizonDays: 14,
  maxPerPhonePerDay: 3,
  autoConfirm: false,
  allowedTypeLabels: null as string[] | null,
  blackoutDates: [] as string[],
  noticeText: '',
};

// Per-IP ceiling on booking attempts, independent of the per-phone cap.
const IP_BOOKING_LIMIT = 12;
const IP_WINDOW_MINUTES = 60;

interface AppointmentTypeConfig {
  id?: string;
  label?: string;
  duration?: number;
  color?: string;
  feeType?: string;
  customFee?: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// A disabled clinic and a nonexistent one must be indistinguishable, otherwise
// the endpoint becomes a directory of every clinic on the platform.
const notFound = () => json({ status: 'not_found' }, 200);

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function cleanSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(slug) ? slug : null;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

/** Digits only; India-friendly 10-digit tail used for matching. */
function normalizePhone(value: unknown): { full: string; last10: string } | null {
  if (typeof value !== 'string') return null;

  const digits = value.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;

  return { full: digits, last10: digits.slice(-10) };
}

async function hashIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0].trim() || 'unknown';
}

/** URL-safe opaque booking reference, e.g. "K3F9-QW7M". */
function makeBookingRef(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

// ---------------------------------------------------------------------------
// Clinic resolution
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

interface ResolvedClinic {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  timeZone: string;
  currency: string;
  defaultDuration: number;
  workingHours: WeeklyAvailability;
  appointmentTypes: AppointmentTypeConfig[];
  fees: { consultation: number | null; followUp: number | null; emergency: number | null };
  policy: typeof POLICY_DEFAULTS;
}

async function resolveClinic(
  supabase: SupabaseClient,
  slug: string,
): Promise<ResolvedClinic | null> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .select(
      'id, clinic_name, address, phone, logo_url, timezone, currency, appointment_duration, working_hours, appointment_types, appointment_config, consultation_fee, follow_up_fee, emergency_fee, public_booking_enabled',
    )
    .eq('public_slug', slug)
    .maybeSingle();

  if (error || !data || !data.public_booking_enabled) return null;

  const rawPolicy = (data.appointment_config ?? {}) as Record<string, unknown>;

  const policy = {
    leadTimeHours: numberOr(rawPolicy.leadTimeHours, POLICY_DEFAULTS.leadTimeHours, 0, 720),
    horizonDays: numberOr(rawPolicy.horizonDays, POLICY_DEFAULTS.horizonDays, 1, 90),
    maxPerPhonePerDay: numberOr(
      rawPolicy.maxPerPhonePerDay,
      POLICY_DEFAULTS.maxPerPhonePerDay,
      1,
      50,
    ),
    autoConfirm: rawPolicy.autoConfirm === true,
    allowedTypeLabels: Array.isArray(rawPolicy.allowedTypeLabels)
      ? (rawPolicy.allowedTypeLabels as string[])
      : null,
    blackoutDates: Array.isArray(rawPolicy.blackoutDates)
      ? (rawPolicy.blackoutDates as string[]).filter((d) => parseDateKey(d) !== null)
      : [],
    noticeText: cleanText(rawPolicy.noticeText, 400),
  };

  return {
    id: data.id,
    name: data.clinic_name ?? '',
    address: data.address ?? null,
    phone: data.phone ?? null,
    logoUrl: data.logo_url ?? null,
    timeZone: data.timezone || DEFAULT_TIMEZONE,
    currency: data.currency || 'INR',
    defaultDuration: numberOr(data.appointment_duration, DEFAULT_DURATION_MINUTES, 5, 240),
    workingHours: (data.working_hours ?? {}) as WeeklyAvailability,
    appointmentTypes: Array.isArray(data.appointment_types) ? data.appointment_types : [],
    fees: {
      consultation: data.consultation_fee ?? null,
      followUp: data.follow_up_fee ?? null,
      emergency: data.emergency_fee ?? null,
    },
    policy,
  };
}

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Appointment types the public may book, after the allow-list filter. */
function publicAppointmentTypes(clinic: ResolvedClinic) {
  const allowed = clinic.policy.allowedTypeLabels;

  return clinic.appointmentTypes
    .filter((type) => typeof type?.label === 'string' && type.label.trim() !== '')
    .filter((type) => !allowed || allowed.includes(type.label!))
    .map((type) => ({
      label: type.label!,
      duration: numberOr(type.duration, clinic.defaultDuration, 5, 240),
      color: typeof type.color === 'string' ? type.color : '#3B82F6',
      fee: resolveFee(type, clinic),
    }));
}

function resolveFee(type: AppointmentTypeConfig, clinic: ResolvedClinic): number | null {
  switch (type.feeType) {
    case 'followup':
      return clinic.fees.followUp;
    case 'emergency':
      return clinic.fees.emergency;
    case 'custom':
      return typeof type.customFee === 'number' ? type.customFee : null;
    default:
      return clinic.fees.consultation;
  }
}

/** A doctor's schedule, falling back to clinic working hours like the app does. */
function availabilityFor(
  doctorAvailability: unknown,
  clinic: ResolvedClinic,
): WeeklyAvailability {
  if (doctorAvailability && typeof doctorAvailability === 'object') {
    return doctorAvailability as WeeklyAvailability;
  }
  return clinic.workingHours;
}

async function loadBookableDoctors(supabase: SupabaseClient, clinicId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, specialization, qualification, consultation_fee, doctor_availability')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .eq('is_open_for_consultation', true)
    .order('name', { ascending: true });

  if (error) return [];
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Rate limiting (first consumer of the pre-existing api_rate_limits table)
// ---------------------------------------------------------------------------

async function checkRateLimit(
  supabase: SupabaseClient,
  identifier: string,
  endpoint: string,
  limit: number,
  windowMinutes: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(now - windowMinutes * 60_000).toISOString();

  // Not `.maybeSingle()`: concurrent requests can create duplicate rows and we
  // would rather throttle on the newest window than throw.
  const { data, error } = await supabase
    .from('api_rate_limits')
    .select('id, request_count, window_start')
    .eq('identifier', identifier)
    .eq('endpoint', endpoint)
    .gte('window_start', windowStart)
    .order('window_start', { ascending: false })
    .limit(1);

  // Fail open on infrastructure errors: a broken counter must not take the
  // booking page down.
  if (error) return true;

  const current = data?.[0];

  if (!current) {
    await supabase.from('api_rate_limits').insert({
      identifier,
      endpoint,
      request_count: 1,
      window_start: new Date(now).toISOString(),
    });
    return true;
  }

  if ((current.request_count ?? 0) >= limit) return false;

  await supabase
    .from('api_rate_limits')
    .update({
      request_count: (current.request_count ?? 0) + 1,
      updated_at: new Date(now).toISOString(),
    })
    .eq('id', current.id);

  return true;
}

// ---------------------------------------------------------------------------
// Busy intervals
// ---------------------------------------------------------------------------

async function loadBusyIntervals(
  supabase: SupabaseClient,
  doctorId: string,
  fromIso: string,
  toIso: string,
  fallbackDuration: number,
): Promise<BusyInterval[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('appointment_date, duration, status')
    .eq('doctor_id', doctorId)
    .in('status', BLOCKING_STATUSES)
    .gte('appointment_date', fromIso)
    .lte('appointment_date', toIso);

  if (error || !data) return [];

  return data.map((row: { appointment_date: string; duration: number | null }) => {
    const start = new Date(row.appointment_date).getTime();
    const minutes = numberOr(row.duration, fallbackDuration, 1, 720);
    return { start, end: start + minutes * 60_000 };
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return json({ error: 'Invalid request body' }, 400);
    }

    const action = (payload as { action?: unknown }).action;

    // `cancel` is keyed off the booking ref, not the slug.
    if (action === 'cancel') {
      return await handleCancel(supabase, req, payload as Record<string, unknown>);
    }

    const slug = cleanSlug((payload as { slug?: unknown }).slug);
    if (!slug) return notFound();

    const clinic = await resolveClinic(supabase, slug);
    if (!clinic) return notFound();

    switch (action) {
      case 'clinic':
        return await handleClinic(supabase, clinic);
      case 'slots':
        return await handleSlots(supabase, clinic, payload as Record<string, unknown>);
      case 'book':
        return await handleBook(supabase, req, clinic, payload as Record<string, unknown>);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (error) {
    console.error('[public-booking] unhandled', error);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});

// --- clinic ----------------------------------------------------------------
// Everything the page needs to render step 1, in one round trip.

async function handleClinic(supabase: SupabaseClient, clinic: ResolvedClinic) {
  const doctors = await loadBookableDoctors(supabase, clinic.id);
  const types = publicAppointmentTypes(clinic);

  return json({
    status: 'ok',
    clinic: {
      name: clinic.name,
      address: clinic.address,
      phone: clinic.phone,
      logoUrl: clinic.logoUrl,
      timeZone: clinic.timeZone,
      currency: clinic.currency,
      notice: clinic.policy.noticeText,
      horizonDays: clinic.policy.horizonDays,
      today: todayInZone(clinic.timeZone),
      blackoutDates: clinic.policy.blackoutDates,
    },
    appointmentTypes: types.length > 0
      ? types
      : [{
        label: 'Consultation',
        duration: clinic.defaultDuration,
        color: '#3B82F6',
        fee: clinic.fees.consultation,
      }],
    doctors: doctors.map(
      (doctor: {
        id: string;
        name: string | null;
        specialization: string | null;
        qualification: string | null;
        consultation_fee: number | null;
        doctor_availability: unknown;
      }) => {
        const availability = availabilityFor(doctor.doctor_availability, clinic);

        return {
          id: doctor.id,
          name: doctor.name ?? 'Doctor',
          specialization: doctor.specialization ?? null,
          qualification: doctor.qualification ?? null,
          fee: doctor.consultation_fee ?? clinic.fees.consultation,
          // Lets the date strip grey out closed days without a request per day.
          openDays: Object.entries(availability)
            .filter(([, day]) => day && day.isOpen)
            .map(([weekday]) => weekday.toLowerCase()),
        };
      },
    ),
  });
}

// --- slots -----------------------------------------------------------------

async function handleSlots(
  supabase: SupabaseClient,
  clinic: ResolvedClinic,
  payload: Record<string, unknown>,
) {
  const doctorId = typeof payload.doctorId === 'string' ? payload.doctorId : '';
  const dateKey = typeof payload.date === 'string' ? payload.date : '';

  if (!doctorId || !parseDateKey(dateKey)) {
    return json({ error: 'Invalid doctor or date' }, 400);
  }

  const today = todayInZone(clinic.timeZone);
  const horizonEnd = addDaysToKey(today, clinic.policy.horizonDays);
  if (dateKey < today || dateKey > horizonEnd) {
    return json({ status: 'ok', slots: [] });
  }

  const doctors = await loadBookableDoctors(supabase, clinic.id);
  const doctor = doctors.find((entry: { id: string }) => entry.id === doctorId);
  if (!doctor) return json({ status: 'ok', slots: [] });

  const requestedType = cleanText(payload.typeLabel, 60);
  const types = publicAppointmentTypes(clinic);
  const matchedType = types.find((type) => type.label === requestedType);
  const duration = matchedType?.duration ?? clinic.defaultDuration;

  const range = clinicDayRangeUtc(dateKey, clinic.timeZone);
  if (!range) return json({ status: 'ok', slots: [] });

  const busy = await loadBusyIntervals(
    supabase,
    doctorId,
    range.fromIso,
    range.toIso,
    clinic.defaultDuration,
  );

  const slots = generateFreeSlots({
    dateKey,
    availability: availabilityFor(doctor.doctor_availability, clinic),
    durationMinutes: duration,
    timeZone: clinic.timeZone,
    busy,
    notBeforeMs: Date.now() + clinic.policy.leadTimeHours * 60 * 60_000,
    blackoutDates: clinic.policy.blackoutDates,
  });

  return json({
    status: 'ok',
    duration,
    slots: slots.map((slot) => ({ start: slot.startIso, label: slot.label })),
  });
}

// --- book ------------------------------------------------------------------

async function handleBook(
  supabase: SupabaseClient,
  req: Request,
  clinic: ResolvedClinic,
  payload: Record<string, unknown>,
) {
  const doctorId = typeof payload.doctorId === 'string' ? payload.doctorId : '';
  const startIso = typeof payload.start === 'string' ? payload.start : '';
  const name = cleanText(payload.name, 100);
  const phone = normalizePhone(payload.phone);
  const notes = cleanText(payload.notes, 500);
  const genderInput = cleanText(payload.gender, 10).toLowerCase();
  const gender = ['male', 'female', 'other'].includes(genderInput) ? genderInput : null;

  const ageRaw = Number(payload.age);
  const age = Number.isFinite(ageRaw) && ageRaw > 0 && ageRaw < 120
    ? Math.round(ageRaw)
    : null;

  if (name.length < 2) return json({ status: 'invalid', field: 'name' }, 200);
  if (!phone) return json({ status: 'invalid', field: 'phone' }, 200);
  if (!doctorId) return json({ status: 'invalid', field: 'doctor' }, 200);

  const startDate = new Date(startIso);
  if (Number.isNaN(startDate.getTime())) {
    return json({ status: 'invalid', field: 'slot' }, 200);
  }

  // Rate limits before any write.
  const ipKey = await hashIdentifier(clientIp(req));
  const ipAllowed = await checkRateLimit(
    supabase,
    `ip:${ipKey}`,
    'public-booking:book',
    IP_BOOKING_LIMIT,
    IP_WINDOW_MINUTES,
  );
  if (!ipAllowed) return json({ status: 'rate_limited' }, 200);

  const phoneAllowed = await checkRateLimit(
    supabase,
    `phone:${clinic.id}:${phone.last10}`,
    'public-booking:book',
    clinic.policy.maxPerPhonePerDay,
    24 * 60,
  );
  if (!phoneAllowed) return json({ status: 'rate_limited' }, 200);

  const doctors = await loadBookableDoctors(supabase, clinic.id);
  const doctor = doctors.find((entry: { id: string }) => entry.id === doctorId);
  if (!doctor) return json({ status: 'slot_taken' }, 200);

  const requestedType = cleanText(payload.typeLabel, 60);
  const types = publicAppointmentTypes(clinic);
  const matchedType = types.find((type) => type.label === requestedType) ?? types[0];
  const typeLabel = matchedType?.label ?? 'Consultation';
  const duration = matchedType?.duration ?? clinic.defaultDuration;

  // Re-derive the free slots server-side and require an exact match. The client
  // is never trusted about what was available -- this rejects stale slots,
  // hand-crafted timestamps, off-grid times, and lead-time violations in one go.
  const dateKey = dateKeyInZone(startDate, clinic.timeZone);
  const range = clinicDayRangeUtc(dateKey, clinic.timeZone);
  if (!range) return json({ status: 'slot_taken' }, 200);

  const busy = await loadBusyIntervals(
    supabase,
    doctorId,
    range.fromIso,
    range.toIso,
    clinic.defaultDuration,
  );

  const freeSlots = generateFreeSlots({
    dateKey,
    availability: availabilityFor(doctor.doctor_availability, clinic),
    durationMinutes: duration,
    timeZone: clinic.timeZone,
    busy,
    notBeforeMs: Date.now() + clinic.policy.leadTimeHours * 60 * 60_000,
    blackoutDates: clinic.policy.blackoutDates,
  });

  const chosen = freeSlots.find((slot) => slot.startMs === startDate.getTime());
  if (!chosen) return json({ status: 'slot_taken' }, 200);

  const patient = await resolvePatient(supabase, clinic.id, name, phone, age, gender);
  if (!patient) return json({ error: 'Could not register patient' }, 500);

  // A patient record has to exist before the appointment can reference it, but
  // the appointment insert can still lose the slot race below. If that happens
  // after we created a brand-new patient, the record is rolled back by hand --
  // otherwise every lost race would litter the clinic's patient list with a
  // person who has no appointment.
  const rollbackNewPatient = async () => {
    if (!patient.created) return;
    await supabase.from('patients').delete().eq('id', patient.id);
  };

  const bookingRef = makeBookingRef();

  const { error: insertError } = await supabase.from('appointments').insert({
    patient_id: patient.id,
    doctor_id: doctorId,
    clinic_id: clinic.id,
    appointment_date: chosen.startIso,
    duration,
    status: clinic.policy.autoConfirm ? 'Confirmed' : 'Scheduled',
    appointment_type: typeLabel,
    notes: notes || null,
    booking_source: 'public',
    public_ref: bookingRef,
  });

  if (insertError) {
    await rollbackNewPatient();

    // 23505 on idx_appointments_no_double_book: someone took the slot between
    // our availability check and this insert. The DB index is what actually
    // makes concurrent booking safe; this branch just reports it politely.
    if ((insertError as { code?: string }).code === '23505') {
      return json({ status: 'slot_taken' }, 200);
    }
    console.error('[public-booking] insert failed', insertError);
    return json({ error: 'Could not save the appointment' }, 500);
  }

  return json({
    status: 'booked',
    ref: bookingRef,
    doctorName: doctor.name ?? 'Doctor',
    appointmentType: typeLabel,
    duration,
    start: chosen.startIso,
    display: formatInZone(new Date(chosen.startIso), clinic.timeZone),
    autoConfirmed: clinic.policy.autoConfirm,
  });
}

/**
 * Find or create the patient behind a public booking.
 *
 * Matched on clinic + phone-number tail + name, deliberately *not* phone alone:
 * families share a mobile number, and collapsing them onto one record would
 * merge unrelated people's medical histories. A phone match with a different
 * name creates a separate patient, which reception can merge later if it really
 * was a typo.
 *
 * Nothing about a matched patient is ever returned to the caller -- otherwise
 * this becomes a lookup oracle for anyone who can guess a phone number.
 *
 * Age and gender are written only on creation. An existing record has been
 * curated by clinic staff, and an unauthenticated form must not be able to
 * overwrite it -- anyone who knows a phone number and name could otherwise
 * rewrite that patient's demographics.
 */
async function resolvePatient(
  supabase: SupabaseClient,
  clinicId: string,
  name: string,
  phone: { full: string; last10: string },
  age: number | null,
  gender: string | null,
): Promise<{ id: string; created: boolean } | null> {
  const { data: candidates } = await supabase
    .from('patients')
    .select('id, name, phone')
    .eq('clinic_id', clinicId)
    .eq('is_hidden', false)
    .ilike('phone', `%${phone.last10}`)
    .limit(25);

  const target = name.toLowerCase();
  const match = (candidates ?? []).find(
    (candidate: { name: string | null }) =>
      (candidate.name ?? '').trim().toLowerCase() === target,
  );

  if (match) return { id: match.id, created: false };

  // `trigger_assign_patient_number` fills patient_number as long as clinic_id
  // is present, so a service-role insert needs nothing extra.
  const { data: created, error } = await supabase
    .from('patients')
    .insert({
      name,
      phone: phone.full,
      clinic_id: clinicId,
      ...(age !== null ? { age } : {}),
      ...(gender !== null ? { gender } : {}),
      mobile_verified: false, // Phase 1 has no OTP.
    })
    .select('id')
    .single();

  if (error) {
    console.error('[public-booking] patient insert failed', error);
    return null;
  }

  return { id: created.id, created: true };
}

// --- cancel ----------------------------------------------------------------

async function handleCancel(
  supabase: SupabaseClient,
  req: Request,
  payload: Record<string, unknown>,
) {
  const ref = cleanText(payload.ref, 20).toUpperCase();
  const phone = normalizePhone(payload.phone);

  if (!ref || !phone) return json({ status: 'not_found' }, 200);

  const ipKey = await hashIdentifier(clientIp(req));
  const allowed = await checkRateLimit(
    supabase,
    `ip:${ipKey}`,
    'public-booking:cancel',
    20,
    IP_WINDOW_MINUTES,
  );
  if (!allowed) return json({ status: 'rate_limited' }, 200);

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, status, appointment_date, patients!inner(phone)')
    .eq('public_ref', ref)
    .maybeSingle();

  if (!appointment) return json({ status: 'not_found' }, 200);

  // The ref alone is not enough; the phone on the record must match too.
  const onRecord = (appointment.patients as { phone?: string } | null)?.phone ?? '';
  if (onRecord.replace(/\D/g, '').slice(-10) !== phone.last10) {
    return json({ status: 'not_found' }, 200);
  }

  if (!BLOCKING_STATUSES.includes(appointment.status)) {
    return json({ status: 'not_cancellable' }, 200);
  }

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', appointment.id);

  if (error) return json({ error: 'Could not cancel' }, 500);

  return json({ status: 'cancelled' });
}
