// Helpers for the optional patient date of birth.
// DOB is stored as a plain `date` (YYYY-MM-DD) so it is parsed as a local calendar
// date here — `new Date('YYYY-MM-DD')` would shift by the UTC offset.

export const parseDob = (dob: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (parsed.getFullYear() !== Number(year) || parsed.getMonth() !== Number(month) - 1) {
    return null; // rejects impossible dates like 2024-02-31
  }
  return parsed;
};

// Completed years between the date of birth and today.
export const calculateAgeFromDob = (dob: string): number | null => {
  const birthDate = parseDob(dob);
  if (!birthDate) return null;

  const today = new Date();
  if (birthDate > today) return null;

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
};

export const formatDob = (dob?: string | null): string => {
  if (!dob) return '';
  const birthDate = parseDob(dob);
  if (!birthDate) return '';
  return birthDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Value for the `max` attribute of a DOB input — a birth date can never be in the future.
export const todayForDobInput = (): string => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};
