import type { VisitType } from '../types';

export const VISIT_TYPES: ReadonlyArray<{ value: VisitType; label: string }> = [
  { value: 'new', label: 'New Visit' },
  { value: 'follow_up', label: 'Follow-up Visit' },
  { value: 'emergency', label: 'Emergency Visit' },
];

export const getVisitTypeLabel = (value?: VisitType | null): string =>
  VISIT_TYPES.find(type => type.value === value)?.label ?? 'Unclassified';

const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '');

/** Only recognized clinical categories; pricing fields do not determine visit type. */
export function visitTypeFromAppointment(
  value?: string | null,
  configuredTypes: ReadonlyArray<{ id: string; label: string }> = [],
): VisitType | null {
  if (!value) return null;
  const classify = (input: string): VisitType | null => {
    switch (normalize(input)) {
      case 'new': case 'newvisit': case 'newconsultation': case 'consultation': return 'new';
      case 'followup': case 'followupvisit': return 'follow_up';
      case 'emergency': case 'emergencyvisit': return 'emergency';
      default: return null;
    }
  };
  const direct = classify(value);
  if (direct) return direct;
  const configured = configuredTypes.find(type =>
    normalize(type.label) === normalize(value) || normalize(type.id) === normalize(value));
  return configured ? classify(configured.id) : null;
}

export function summarizeVisitTypes(visits: ReadonlyArray<{ visitType?: VisitType | null }>) {
  const counts = { new: 0, follow_up: 0, emergency: 0, unclassified: 0 };
  for (const visit of visits) counts[visit.visitType ?? 'unclassified'] += 1;
  return counts;
}

/** Local calendar boundaries include every time on the selected end date. */
export function visitMatchesDateRange(date: Date, from: string, to: string): boolean {
  if (from && date < new Date(`${from}T00:00:00`)) return false;
  if (to) {
    const exclusiveEnd = new Date(`${to}T00:00:00`);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    if (date >= exclusiveEnd) return false;
  }
  return true;
}
