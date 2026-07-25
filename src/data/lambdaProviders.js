// Auto-generated from LCA-Table-Project-Analysis `lambda_providers` sheet.
// Regenerate by re-exporting that sheet to JSON if the team updates the values —
// don't hand-edit this file and the spreadsheet separately, they'll drift.
import raw from './lambdaProviders.json';

/** @typedef {{
 *   id: string,
 *   material: string,
 *   provider: string,
 *   lambda: number|null,          // W/mK, null when N/A or excluded (see lambdaNote)
 *   lambdaNote: string|null,      // e.g. "excl." or "N/A – use Uf"
 *   basis: string,
 *   source: string,
 *   confidence: 'high'|'medium'|'low',
 *   confidenceLabel: string,
 *   notes: string|null
 * }} LambdaEntry
 */

/** @type {Record<string, LambdaEntry[]>} */
export const lambdaByDiscipline = raw;

/** Flat list, every material across every discipline. */
export const lambdaFlat = Object.entries(raw).flatMap(([discipline, items]) =>
  items.map((item) => ({ ...item, discipline }))
);

export const disciplines = Object.keys(raw);

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (ö -> o etc.)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Best-effort match between an Ökobaudat process name and our local λ dataset.
 * Matching is intentionally loose (word-overlap) since Ökobaudat naming and our
 * midterm-slide naming rarely line up exactly — always show the match to the
 * user rather than auto-applying it silently.
 * @param {string} okobaudatName
 * @param {string} [discipline] narrows the search when known
 * @returns {(LambdaEntry & {discipline: string, matchScore: number}) | null}
 */
export function findLambdaMatch(okobaudatName, discipline) {
  const pool = discipline && lambdaByDiscipline[discipline]
    ? lambdaByDiscipline[discipline].map((e) => ({ ...e, discipline }))
    : lambdaFlat;

  const target = normalize(okobaudatName);
  const targetWords = new Set(target.split(' ').filter((w) => w.length > 2));
  if (targetWords.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const entry of pool) {
    const candidate = normalize(entry.material);
    const candWords = candidate.split(' ').filter((w) => w.length > 2);
    if (candWords.length === 0) continue;
    const overlap = candWords.filter((w) => targetWords.has(w)).length;
    const score = overlap / Math.max(candWords.length, targetWords.size);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  // require at least a third of the words to line up before calling it a match
  if (best && bestScore >= 0.34) {
    return { ...best, matchScore: Math.round(bestScore * 100) / 100 };
  }
  return null;
}

/** Lookup by our own slug id (stable, use this once a user has confirmed a match). */
export function getLambdaById(id) {
  return lambdaFlat.find((e) => e.id === id) || null;
}
