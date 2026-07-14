// Loose fuzzy matcher for master search boxes (services, tests…).
// Word-order independent, punctuation-blind ("xray" hits "X-Ray Chest PA"),
// acronym-aware ("cbc" hits "Complete Blood Count"), subsequence fallback
// tolerates skipped letters. Every query token must match somewhere.

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

/** Score one query token against one field. 0 = no match. */
function tokenScore(token: string, field: string): number {
  if (!field) return 0;
  if (field === token) return 120;
  if (field.startsWith(token)) return 100;
  const words = field.split(' ');
  if (words.some((w) => w.startsWith(token))) return 80;
  const acronym = words.map((w) => w[0]).join('');
  if (token.length >= 2 && acronym.includes(token)) return 70;
  if (field.replace(/ /g, '').includes(token)) return 60;
  if (token.length >= 4 && isSubsequence(token, field.replace(/ /g, ''))) return 25;
  return 0;
}

/**
 * Match `query` against `fields` (e.g. [code, name, group]). Returns 0 when
 * any token misses everywhere; otherwise the summed best-field score, with
 * earlier fields winning ties via a tiny weight bump.
 */
export function fuzzyScore(query: string, fields: Array<string | null | undefined>): number {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return 0;
  const normFields = fields.map((f) => normalize(f ?? ''));

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    normFields.forEach((f, idx) => {
      const s = tokenScore(token, f);
      if (s > 0) best = Math.max(best, s + (normFields.length - idx));
    });
    if (best === 0) return 0; // every token must land
    total += best;
  }
  return total;
}

/** Rank `items` by fuzzy score of `query` over `getFields`, best first. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getFields: (item: T) => Array<string | null | undefined>,
  limit = 30
): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getFields(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
