import type { DietRoute, DietType } from '../types/ipd';

/**
 * Canonical diet codes and the normalisation used when a value comes from
 * outside the UI (voice dictation, imports). Both `diet_type` and `route` are
 * CHECK-constrained on `ipd_diet_orders`, so an unrecognised code would fail
 * the insert and silently lose the doctor's diet order.
 *
 * Pure value logic — no I/O, so it stays testable in isolation.
 */

export const DIET_TYPE_CODES: DietType[] = [
  'normal', 'soft', 'liquid', 'semi_solid', 'diabetic', 'renal', 'cardiac',
  'low_salt', 'high_protein', 'low_fat', 'bland', 'pediatric', 'npo', 'other',
];

export const DIET_ROUTE_CODES: DietRoute[] = ['oral', 'ryles_tube', 'peg', 'npo', 'tpn'];

const toCode = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Normalise a spoken diet code onto the allowed enum.
 * Returns `spoken` when the wording could not be matched, so the caller can
 * keep the original phrasing in the instructions rather than discarding it.
 */
export const toDietType = (raw: unknown): { type: DietType; spoken: string | null } => {
  const code = toCode(raw);
  if ((DIET_TYPE_CODES as string[]).includes(code)) return { type: code as DietType, spoken: null };
  const spoken = String(raw ?? '').trim();
  return { type: 'other', spoken: spoken || null };
};

export const toDietRoute = (raw: unknown): DietRoute => {
  const code = toCode(raw);
  return (DIET_ROUTE_CODES as string[]).includes(code) ? (code as DietRoute) : 'oral';
};
