// Timezone-aware appointment slot generation.
//
// This is the public-booking counterpart to the client-side logic in
// src/services/doctorAvailabilityService.ts. That version runs in the browser,
// where local time happens to be clinic time, so it can get away with
// `new Date(...).setHours(...)`. Here we run in Deno under UTC, and the
// availability config stores wall-clock strings ("09:00") that mean *clinic*
// wall clock. Getting that wrong shifts every slot by the UTC offset -- 5h30m
// for Asia/Kolkata -- silently and consistently, which is the worst kind of bug.
// So every conversion goes through the clinic's IANA timezone explicitly.

export interface DayAvailability {
  isOpen: boolean;
  startTime: string; // "HH:MM" clinic-local
  endTime: string; // "HH:MM" clinic-local
  breakStart?: string;
  breakEnd?: string;
}

/** Keyed by lowercase English weekday: monday, tuesday, ... */
export type WeeklyAvailability = Record<string, DayAvailability | undefined>;

export interface BusyInterval {
  /** UTC epoch ms */
  start: number;
  /** UTC epoch ms */
  end: number;
}

export interface GeneratedSlot {
  /** UTC epoch ms of slot start */
  startMs: number;
  /** ISO-8601 UTC instant, what gets stored in appointments.appointment_date */
  startIso: string;
  /** Clinic-local "HH:MM" label for display */
  label: string;
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Offset of `timeZone` from UTC at the given instant, in milliseconds.
 * Positive east of Greenwich (Asia/Kolkata => +19_800_000).
 */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  // Some ICU builds report midnight as hour "24".
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - instant.getTime();
}

/**
 * Convert a clinic-local wall-clock time to a UTC instant.
 *
 * Two passes: the offset itself depends on the instant we are trying to find,
 * so we guess with the offset at the naive timestamp, then re-resolve. This
 * settles DST transitions. India has no DST, but clinics on other timezones
 * would silently drift for half the year without it.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstGuess = new Date(naiveUtc - tzOffsetMs(new Date(naiveUtc), timeZone));
  const settledOffset = tzOffsetMs(firstGuess, timeZone);

  return new Date(naiveUtc - settledOffset);
}

/**
 * The calendar date an instant falls on in the given timezone, as "YYYY-MM-DD".
 * An 18:30 UTC instant is already "tomorrow" in Asia/Kolkata, which is exactly
 * the distinction the booking flow has to get right.
 */
export function dateKeyInZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Today's date in the clinic's timezone as "YYYY-MM-DD". */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return dateKeyInZone(now, timeZone);
}

/** Parse "YYYY-MM-DD" into calendar parts. Returns null if malformed or invalid. */
export function parseDateKey(
  dateKey: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip to reject things like 2026-02-31.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Lowercase weekday name for a calendar date. Pure calendar math, timezone-free. */
export function weekdayOf(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** Add `days` to a "YYYY-MM-DD" key, returning a new key. */
export function addDaysToKey(dateKey: string, days: number): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;

  const shifted = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days),
  );

  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** "HH:MM" -> minutes since midnight, or null if malformed. */
function parseClockMinutes(value: string | undefined): number | null {
  if (!value) return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function formatClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface GenerateSlotsOptions {
  /** Clinic-local date, "YYYY-MM-DD". */
  dateKey: string;
  availability: WeeklyAvailability;
  /** Slot length in minutes. */
  durationMinutes: number;
  timeZone: string;
  /** Already-taken intervals for this doctor, in UTC epoch ms. */
  busy: BusyInterval[];
  /** Slots starting before this instant are dropped (lead time). UTC epoch ms. */
  notBeforeMs: number;
  /** Clinic-local "YYYY-MM-DD" dates on which the clinic takes no bookings. */
  blackoutDates?: string[];
}

/**
 * Free slots for one doctor on one clinic-local day.
 *
 * Only *available* slots come back. The authenticated calendar renders booked
 * slots greyed out, but the public endpoint must not: returning taken slots
 * would leak the doctor's exact appointment times to anyone with the URL.
 */
export function generateFreeSlots(options: GenerateSlotsOptions): GeneratedSlot[] {
  const {
    dateKey,
    availability,
    durationMinutes,
    timeZone,
    busy,
    notBeforeMs,
    blackoutDates = [],
  } = options;

  if (blackoutDates.includes(dateKey)) return [];

  const parsed = parseDateKey(dateKey);
  if (!parsed) return [];

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];

  const day = availability[weekdayOf(parsed.year, parsed.month, parsed.day)];
  if (!day || !day.isOpen) return [];

  const openMinutes = parseClockMinutes(day.startTime);
  const closeMinutes = parseClockMinutes(day.endTime);
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
    return [];
  }

  const breakStartMinutes = parseClockMinutes(day.breakStart);
  const breakEndMinutes = parseClockMinutes(day.breakEnd);
  const hasBreak =
    breakStartMinutes !== null &&
    breakEndMinutes !== null &&
    breakEndMinutes > breakStartMinutes;

  const slots: GeneratedSlot[] = [];

  for (
    let slotStart = openMinutes;
    slotStart + durationMinutes <= closeMinutes;
    slotStart += durationMinutes
  ) {
    const slotEnd = slotStart + durationMinutes;

    if (
      hasBreak &&
      overlaps(slotStart, slotEnd, breakStartMinutes!, breakEndMinutes!)
    ) {
      continue;
    }

    const startUtc = zonedWallClockToUtc(
      parsed.year,
      parsed.month,
      parsed.day,
      Math.floor(slotStart / 60),
      slotStart % 60,
      timeZone,
    );

    const startMs = startUtc.getTime();
    const endMs = startMs + durationMinutes * 60_000;

    if (startMs < notBeforeMs) continue;

    if (busy.some((interval) => overlaps(startMs, endMs, interval.start, interval.end))) {
      continue;
    }

    slots.push({
      startMs,
      startIso: startUtc.toISOString(),
      label: formatClock(slotStart),
    });
  }

  return slots;
}

/**
 * Clinic-local day boundaries as UTC instants, for querying appointments.
 * Widened by a day on each side so an appointment that starts late the previous
 * clinic-local day but runs into this one is still seen as busy.
 */
export function clinicDayRangeUtc(
  dateKey: string,
  timeZone: string,
): { fromIso: string; toIso: string } | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;

  const from = zonedWallClockToUtc(
    parsed.year,
    parsed.month,
    parsed.day,
    0,
    0,
    timeZone,
  );
  const to = zonedWallClockToUtc(
    parsed.year,
    parsed.month,
    parsed.day + 1,
    0,
    0,
    timeZone,
  );

  return {
    fromIso: new Date(from.getTime() - 12 * 60 * 60_000).toISOString(),
    toIso: new Date(to.getTime() + 12 * 60 * 60_000).toISOString(),
  };
}

/** Format a UTC instant as a human label in the clinic's timezone. */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant);
}
