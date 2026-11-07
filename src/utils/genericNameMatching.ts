export interface GenericLookupInput {
  name: string;
  brand_name: string;
  strength: string;
  dosage_form: string;
  manufacturer: string;
  generic_name?: string;
}

export interface ReferenceMedicine {
  id: string;
  name: string;
  manufacturer: string;
  pack: string;
  composition: string;
}

export interface GenericNameCandidate extends ReferenceMedicine {
  genericName: string;
  match: string;
  score: number;
  ingredients?: { name: string; strength: string }[];
  sources?: { url: string; title: string }[];
  notes?: string;
}

export interface GenericNameReview {
  medicine_id: string;
  clinic_id: string;
  input_snapshot: GenericLookupInput;
  candidates: GenericNameCandidate[];
  source_version: string;
  source_url: string;
  status: 'pending' | 'no_match' | 'verified';
  checked_at: string;
  verified_at?: string | null;
  verified_by?: string | null;
  generic_name?: string | null;
  selected_source_id?: string | null;
  previous_generic_name?: string | null;
}

export const lookupInput = (medicine: { name: string; brandName?: string; strength?: string; dosageForm?: string; manufacturer?: string; genericName?: string }): GenericLookupInput => ({
  name: medicine.name.trim(), brand_name: medicine.brandName?.trim() || '', strength: medicine.strength?.trim() || '',
  dosage_form: medicine.dosageForm?.trim() || '', manufacturer: medicine.manufacturer?.trim() || '',
  generic_name: medicine.genericName?.trim() || '',
});

export const sameLookupInput = (a: GenericLookupInput, b: GenericLookupInput) =>
  (Object.keys(a) as Array<keyof GenericLookupInput>).every(key => (a[key] ?? '') === (b[key] ?? ''));

/** Compare labels only: never infer a drug's composition from its brand name. */
export function genericLabelKey(value: string) {
  return value.toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(tablets?|tabs?|capsules?|caps?|injections?|inj|syrup|oral|cream|ointment|drops?|suspension)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function genericNameReviewReason(medicine: { name: string; brandName?: string; genericName?: string }): 'missing' | 'brand_copy' | undefined {
  if (!medicine.genericName?.trim()) return 'missing';
  const key = genericLabelKey(medicine.genericName);
  if (key && [medicine.name, medicine.brandName ?? ''].some(name => genericLabelKey(name) === key)) return 'brand_copy';
  return undefined;
}

export function hasVerifiedGenericName(medicine: Parameters<typeof lookupInput>[0], review?: GenericNameReview) {
  if (review?.status !== 'verified' || !medicine.genericName?.trim() || review.generic_name?.trim() !== medicine.genericName.trim()) return false;
  const input = lookupInput(medicine);
  return sameLookupInput({ ...input, generic_name: '' }, { ...review.input_snapshot, generic_name: '' });
}

export const referenceShard = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 2);

const normalize = (text: string) => text.toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
  .replace(/[^a-z0-9.]+/g, ' ').trim().replace(/\s+/g, ' ');
const productKey = (text: string) => normalize(text).replace(/\b(tablets?|tabs?|capsules?|caps?|injections?|inj|syrup|oral|cream|ointment|drops?|suspension)\b/g, '').replace(/\s+/g, ' ').trim();
const familyKey = (text: string) => productKey(text).replace(/\b(?:\d+(?:\.\d+)?|mg|mcg|ml|gm|g|iu)\b/g, '').replace(/\s+/g, ' ').trim();
const digits = (text: string) => (normalize(text).match(/\d+(?:\.\d+)?/g) ?? []).join('|');
const release = (text: string) => [...new Set(normalize(text).match(/\b(sr|cr|er|xr|xl|mr|dr|dt|md|od)\b/g) ?? [])].sort().join('|');
function form(text: string) {
  const value = normalize(text);
  if (/\b(tablets?|tabs?)\b/.test(value)) return 'tablet';
  if (/\b(capsules?|caps?)\b/.test(value)) return 'capsule';
  if (/\b(injections?|inj)\b/.test(value)) return 'injection';
  return ['syrup', 'cream', 'ointment', 'drops', 'suspension', 'inhaler', 'powder'].find(f => value.includes(f)) ?? '';
}
function spellingSimilarity(a: string, b: string) {
  if (a === b) return 1;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

export function compositionGenericName(composition: string) {
  return composition.replace(/\([^)]*\d[^)]*\)/g, '')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|gm|g|ml|iu|units?|%)\b(?:\s*\/\s*\d*\s*(?:ml|g))?/gi, '')
    .replace(/\s+/g, ' ').replace(/\s*\+\s*/g, ' + ').trim();
}

/** Catalogue retrieval only. Scores rank candidates; they are not clinical confidence. */
export function matchGenericNames(input: GenericLookupInput, records: ReferenceMedicine[]): GenericNameCandidate[] {
  const names = [...new Set([input.name, input.brand_name].filter(Boolean).map(productKey))];
  const families = names.map(familyKey);
  const namedVariant = familyKey(input.name).split(' ').slice(1);
  const expectedForm = form(input.dosage_form) || form(input.name);
  const inputNumbers = digits(input.name);
  const expectedRelease = release(`${input.name} ${input.brand_name}`);
  const output: GenericNameCandidate[] = [];
  for (const record of records) {
    const key = productKey(record.name);
    const sourceForm = form(record.name);
    if (expectedForm && sourceForm && expectedForm !== sourceForm) continue;
    if (expectedRelease && release(record.name) !== expectedRelease) continue;
    // A known product number/strength must not turn into a different variant.
    if (inputNumbers && inputNumbers !== digits(record.name)) continue;
    if (input.strength) {
      if (digits(input.strength) !== digits(record.name) && digits(input.strength) !== digits(record.composition)) continue;
      const wantedUnits: string[] = normalize(input.strength).match(/\b(mcg|mg|gm|g|ml|iu)\b/g) ?? [];
      const sourceUnits: string[] = normalize(record.composition).match(/\b(mcg|mg|gm|g|ml|iu)\b/g) ?? [];
      if (wantedUnits.some(unit => !sourceUnits.includes(unit))) continue;
    }
    const sourceBrand = key.split(' ')[0];
    const sourceFamily = familyKey(record.name);
    // Do not drop brand suffixes such as RD, D, Plus or MPS when the SKU names them.
    if (namedVariant.some(word => !sourceFamily.split(' ').includes(word))) continue;
    const brandScore = Math.max(...names.map(name => spellingSimilarity(name.split(' ')[0], sourceBrand)));
    if (brandScore < 1 && (sourceBrand.length < 5 || brandScore < 0.84)) continue;
    const exact = names.includes(key);
    const genericName = compositionGenericName(record.composition);
    if (!genericName || !/[a-z]/i.test(genericName)) continue;
    let score = exact ? 100 : families.includes(sourceFamily) ? 95 : brandScore === 1 ? 80 - sourceFamily.split(' ').length : 50 + Math.round(brandScore * 10);
    if (input.manufacturer && normalize(record.manufacturer).includes(normalize(input.manufacturer))) score += 5;
    output.push({ ...record, genericName, score, match: exact ? 'Exact product name' : brandScore === 1 ? 'Same brand — check variant' : 'Similar spelling — check product' });
  }
  const seen = new Set<string>();
  return output.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).filter(candidate => {
    const key = `${candidate.name}|${candidate.manufacturer}|${candidate.composition}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}
