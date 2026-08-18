// Client for the public self-booking endpoint.
//
// Deliberately does NOT import the Supabase client. The booking page is served
// to anonymous visitors, and every read it needs is shaped server-side by the
// `public-booking` edge function. Same plain-fetch approach as the other public
// pages (VerifyPrescription, PatientUpload).

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ENDPOINT = `${SUPABASE_URL}/functions/v1/public-booking`;

export interface PublicClinic {
  name: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  timeZone: string;
  currency: string;
  notice: string;
  /** Regional language code for page furniture; '' = English only. */
  language: string;
  horizonDays: number;
  /** Today's date in the CLINIC's timezone -- never trust the device clock. */
  today: string;
  blackoutDates: string[];
}

export interface PublicAppointmentType {
  label: string;
  duration: number;
  color: string;
  fee: number | null;
}

export interface PublicDoctor {
  id: string;
  name: string;
  specialization: string | null;
  qualification: string | null;
  fee: number | null;
  /** Lowercase weekday names this doctor sees patients on. */
  openDays: string[];
}

export interface ClinicResponse {
  clinic: PublicClinic;
  appointmentTypes: PublicAppointmentType[];
  doctors: PublicDoctor[];
}

export interface PublicSlot {
  /** ISO-8601 UTC instant. Passed back verbatim when booking. */
  start: string;
  /** Clinic-local "HH:MM". */
  label: string;
}

export interface BookingRequest {
  slug: string;
  doctorId: string;
  typeLabel: string;
  start: string;
  name: string;
  phone: string;
  age?: string;
  gender?: string;
  notes?: string;
}

export interface BookingSuccess {
  status: 'booked';
  ref: string;
  doctorName: string;
  appointmentType: string;
  duration: number;
  start: string;
  display: string;
  autoConfirmed: boolean;
}

export type BookingResult =
  | BookingSuccess
  | { status: 'slot_taken' }
  | { status: 'rate_limited' }
  | { status: 'invalid'; field: string };

/** Thrown for transport/server failures, as distinct from a business outcome. */
export class PublicBookingError extends Error {}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PublicBookingError('Network unavailable. Please check your connection.');
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new PublicBookingError(
      (payload as { error?: string } | null)?.error ?? 'Something went wrong.',
    );
  }

  return payload as T;
}

export const publicBookingService = {
  /** Clinic, its bookable doctors and appointment types. `null` = no such page. */
  async getClinic(slug: string): Promise<ClinicResponse | null> {
    const data = await post<{ status: string } & ClinicResponse>({ action: 'clinic', slug });
    return data.status === 'ok' ? data : null;
  },

  /** Free slots only -- booked times are never returned. */
  async getSlots(
    slug: string,
    doctorId: string,
    date: string,
    typeLabel: string,
  ): Promise<PublicSlot[]> {
    const data = await post<{ slots?: PublicSlot[] }>({
      action: 'slots',
      slug,
      doctorId,
      date,
      typeLabel,
    });
    return data.slots ?? [];
  },

  async book(request: BookingRequest): Promise<BookingResult> {
    return await post<BookingResult>({ action: 'book', ...request });
  },

  async cancel(ref: string, phone: string): Promise<string> {
    const data = await post<{ status: string }>({ action: 'cancel', ref, phone });
    return data.status;
  },
};

// --- date helpers (clinic-local calendar keys, no Date arithmetic pitfalls) ---

/** Shift a "YYYY-MM-DD" key by whole days. */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Lowercase weekday for a date key. Pure calendar math -- no timezone involved. */
export function weekdayOf(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** Short display parts for the date strip, e.g. { weekday: "Mon", day: "9", month: "Aug" }. */
export function describeDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return {
    weekday: date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    day: String(date.getUTCDate()),
    month: date.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
  };
}

/** "14:30" -> "2:30 PM". Slot labels arrive as clinic-local 24h strings. */
export function formatSlotLabel(label: string): string {
  const [hours, minutes] = label.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}
