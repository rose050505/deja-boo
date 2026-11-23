import type { Graveyard, RevenantHit, Thresholds } from './types.js';
import { matchWindowed } from './match.js';
import { hauntLevel } from './level.js';

/** Share of a matched window that must be added lines for a hit to count. */
export const ADDED_SHARE = 0.5;

/**
 * Indices of `b` that belong to a longest common subsequence with `a` (Myers O(ND) diff).
 * Invariant: the result has exactly LCS(a, b) entries.
 */
function matchedInB(a: string[], b: string[]): Set<number> {
  const matched = new Set<number>();
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) matched.add(lo++);
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) matched.add(--eb), ea--;

  const N = ea - lo;
  const M = eb - lo;
  if (N === 0 || M === 0) return matched;

  const max = N + M;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))) x = v[off + k + 1] as number;
      else x = (v[off + k - 1] as number) + 1;
      let y = x - k;
      while (x < N && y < M && a[lo + x] === b[lo + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) found = d;
    }
    trace.push(v.slice(off - d, off + d + 1));
  }

  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1] as Int32Array;
    const at = (k: number): number => prev[k + d - 1] as number;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { matched.add(lo + y - 1); x--; y--; }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { matched.add(lo + y - 1); x--; y--; }
  return matched;
}

/**
 * 1-based line numbers of `after` that a line diff against `before` marks as inserted or replaced; trimmed lines are compared.
 * Invariant: addedLineNumbers(x, x) is empty; inserting k non-blank lines that are not whitespace variants of existing lines marks exactly those k lines.
 */
export function addedLineNumbers(before: string, after: string): Set<number> {
  const a = before === '' ? [] : before.split('\n').map(l => l.trim());
  const rawAfter = after === '' ? [] : after.split('\n');
  const b = rawAfter.map(l => l.trim());
  const matched = matchedInB(a, b);
  const added = new Set<number>();
  for (let i = 0; i < b.length; i++) if (!matched.has(i)) added.add(i + 1);
  return added;
}

/** Ids named by `deja-boo: checked <40 hex>` in `content`. Invariant: includes every id appended in that form. */
export function acknowledgedIds(content: string): Set<string> {
  const ids = new Set<string>();
  for (const m of content.matchAll(/deja-boo: checked ([0-9a-f]{40})/g)) ids.add(m[1] as string);
  return ids;
}

/**
 * All tombstones with level != 'none', sorted by similarity desc, id asc.
 * With `added`, a hit needs at least half of its matched window in `added`.
 * Invariant: raising a threshold never adds a hit.
 */
export function findRevenants(
  graveyard: Graveyard,
  candidate: string[],
  thresholds: Thresholds,
  added?: ReadonlySet<number>,
): RevenantHit[] {
  const hits: RevenantHit[] = [];
  for (const tombstone of graveyard.tombstones) {
    const m = matchWindowed(tombstone, candidate);
    const level = hauntLevel(tombstone, m.similarity, thresholds);
    if (level === 'none') continue;
    if (added) {
      const [from, to] = m.matchedLines;
      let n = 0;
      for (let i = from; i <= to; i++) if (added.has(i)) n++;
      if (n / (to - from + 1) < ADDED_SHARE) continue;
    }
    hits.push({ tombstone, level, similarity: m.similarity, containment: m.containment, matchedLines: m.matchedLines });
  }
  return hits.sort((x, y) => y.similarity - x.similarity || (x.tombstone.id < y.tombstone.id ? -1 : 1));
}
