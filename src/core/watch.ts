import type { Graveyard, RevenantHit, Thresholds, Tombstone, WindowedMatch } from './types.js';
import { containment, fingerprintLines, similarity } from './match.js';
import { kgramHashSet } from './fingerprint.js';
import { normalizeBlock } from './normalize.js';
import { DEFAULT_MINER_CONFIG } from './types.js';
import { hauntLevel } from './level.js';

/** Minimum rise in similarity, versus the file on disk, for a tombstone that already scored at or above warn to count as made worse. */
export const WORSE_BY = 0.1;

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

export type WindowIndex = { fps: number[][]; byHash: Map<number, number[]> };

/** Fingerprints of every width-`width` window of `candidate`, plus hash -> ascending window starts. */
function indexWindows(candidate: string[], width: number): WindowIndex {
  const fps: number[][] = [];
  const byHash = new Map<number, number[]>();
  for (let start = 0; start + width <= candidate.length; start++) {
    const fp = fingerprintLines(candidate.slice(start, start + width));
    fps.push(fp);
    for (const h of fp) {
      const list = byHash.get(h);
      if (list) list.push(start);
      else byHash.set(h, [start]);
    }
  }
  return { fps, byHash };
}

/**
 * `matchWindowed(t, candidate)` computed from shared window fingerprints. Only windows that share a hash with the tombstone are scored,
 * because every other window has Jaccard 0 and can never beat the "no match" result.
 * Invariant: equals matchWindowed(t, candidate) for every input.
 */
export function matchWindowedIndexed(
  t: Pick<Tombstone, 'lines' | 'fingerprint'>,
  candidate: string[],
  cache: Map<number, WindowIndex>,
): WindowedMatch {
  const none: WindowedMatch = { similarity: 0, matchedLines: [0, 0], containment: 0 };
  const size = t.lines.length;
  if (size === 0 || candidate.length === 0 || t.fingerprint.length === 0) return none;
  const width = Math.min(size, candidate.length);
  let index = cache.get(width);
  if (!index) cache.set(width, (index = indexWindows(candidate, width)));
  const starts = new Set<number>();
  for (const h of t.fingerprint) for (const s of index.byHash.get(h) ?? []) starts.add(s);
  let best = none;
  let bestSim = 0;
  for (const start of [...starts].sort((a, b) => a - b)) {
    const fp = index.fps[start] as number[];
    const sim = similarity(t.fingerprint, fp);
    if (sim > bestSim) {
      bestSim = sim;
      best = { similarity: sim, matchedLines: [start + 1, start + width], containment: containment(t.fingerprint, fp) };
    }
  }
  return best;
}

/**
 * Hashes of all token k-grams of the whole candidate, or undefined when the candidate has a block-comment opener
 * (`/*`, `<!--`, `{-`). Without openers, a window normalizes to a contiguous run of the candidate's normalized lines, so
 * every window k-gram is a candidate k-gram. With openers, a window can start inside a comment, so no prefilter is used.
 */
function candidateKgrams(candidate: string[]): Set<number> | undefined {
  const raw = candidate.join('\n');
  if (raw.includes('/*') || raw.includes('<!--') || raw.includes('{-')) return undefined;
  return kgramHashSet(normalizeBlock(candidate, DEFAULT_MINER_CONFIG), DEFAULT_MINER_CONFIG.kgramSize);
}

function sharedCount(fingerprint: number[], grams: ReadonlySet<number>): number {
  let n = 0;
  for (const h of fingerprint) if (grams.has(h)) n++;
  return n;
}

/** Minimum share of a tombstone's distinct hashes that a write must bring back for the one-line-difference rule. */
export const RECOVERY_SHARE = 0.5;

/**
 * Fingerprint hashes of `tombstone` absent from the k-gram hash set of `beforeText` (distinct), and how many of those the k-gram hash set of `afterText` contains (recovered).
 * Invariant: recovered <= distinct, and recovered is 0 when afterText equals beforeText.
 */
export function distinctRecovery(tombstone: Pick<Tombstone, 'fingerprint'>, beforeText: string, afterText: string): { distinct: number; recovered: number } {
  const grams = (text: string): Set<number> =>
    kgramHashSet(normalizeBlock(text === '' ? [] : text.split('\n'), DEFAULT_MINER_CONFIG), DEFAULT_MINER_CONFIG.kgramSize);
  const inBefore = grams(beforeText);
  const inAfter = grams(afterText);
  let distinct = 0;
  let recovered = 0;
  for (const h of tombstone.fingerprint) {
    if (inBefore.has(h)) continue;
    distinct++;
    if (inAfter.has(h)) recovered++;
  }
  return { distinct, recovered };
}

/**
 * All tombstones with level != 'none', sorted by similarity desc, id asc.
 * With `before` (the lines on disk, empty for a new file), a hit is kept only if the write makes it worse: its level on `before` is 'none',
 * its similarity rose by at least WORSE_BY, or the write recovers at least RECOVERY_SHARE of the tombstone's hashes missing from `before` (distinctRecovery). Unchanged or unrelated edits never raise a score, so they never fire.
 * Invariant: raising a threshold never adds a hit; with `before` equal to `candidate` there are no hits.
 */
export function findRevenants(
  graveyard: Graveyard,
  candidate: string[],
  thresholds: Thresholds,
  before?: string[],
): RevenantHit[] {
  const hits: RevenantHit[] = [];
  const cache = new Map<number, WindowIndex>();
  const grams = candidateKgrams(candidate);
  const beforeCache = new Map<number, WindowIndex>();
  const beforeGrams = before ? candidateKgrams(before) : undefined;
  for (const tombstone of graveyard.tombstones) {
    // Exact prefilter: a window scores Jaccard >= warn only if it shares >= warn * |fingerprint| hashes with the tombstone,
    // and every window hash is in `grams`. Fewer shared hashes mean level 'none' for every window.
    if (grams && sharedCount(tombstone.fingerprint, grams) < thresholds.warn * tombstone.fingerprint.length - 1e-9) continue;
    const m = matchWindowedIndexed(tombstone, candidate, cache);
    const level = hauntLevel(tombstone, m.similarity, thresholds);
    if (level === 'none') continue;
    if (before) {
      const skipBefore = beforeGrams && sharedCount(tombstone.fingerprint, beforeGrams) < thresholds.warn * tombstone.fingerprint.length - 1e-9;
      if (!skipBefore) {
        const sBefore = matchWindowedIndexed(tombstone, before, beforeCache).similarity;
        if (hauntLevel(tombstone, sBefore, thresholds) !== 'none' && m.similarity < sBefore + WORSE_BY - 1e-9) {
          const { distinct, recovered } = distinctRecovery(tombstone, before.join('\n'), candidate.join('\n'));
          if (!(distinct >= 1 && recovered / distinct >= RECOVERY_SHARE)) continue;
        }
      }
    }
    hits.push({ tombstone, level, similarity: m.similarity, containment: m.containment, matchedLines: m.matchedLines });
  }
  return hits.sort((x, y) => y.similarity - x.similarity || (x.tombstone.id < y.tombstone.id ? -1 : 1));
}
