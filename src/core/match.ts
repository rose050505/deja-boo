import type { MinerConfig, Tombstone, WindowedMatch } from './types.js';
import { DEFAULT_MINER_CONFIG } from './types.js';
import { normalizeBlock } from './normalize.js';
import { kgramWinnow } from './fingerprint.js';

type MatchConfig = Pick<MinerConfig, 'kgramSize' | 'windowSize' | 'renameIds'>;

/**
 * Jaccard similarity between two sorted fingerprint arrays.
 * Uses a two-pointer O(n + m) intersection/union.
 * Invariant: similarity(fp, fp) === 1 for any non-empty fp; result in [0, 1].
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  let intersection = 0;
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const av = a[i] as number;
    const bv = b[j] as number;
    if (av === bv) {
      intersection++;
      i++;
      j++;
    } else if (av < bv) {
      i++;
    } else {
      j++;
    }
  }

  // |A ∪ B| = |A| + |B| - |A ∩ B|
  const union = a.length + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Fraction of `a` that occurs in sorted `b`: |A ∩ B| / |A|.
 * Invariant: containment(a, a) === 1 for non-empty a; result in [0, 1]; 0 when a is empty.
 */
export function containment(a: number[], b: number[]): number {
  if (a.length === 0) return 0;
  let hit = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const av = a[i] as number;
    const bv = b[j] as number;
    if (av === bv) { hit++; i++; j++; }
    else if (av < bv) i++;
    else j++;
  }
  return hit / a.length;
}

/** Minimum share of a tombstone's fingerprint that must occur at HEAD to count as alive. */
export const ALIVE_AT_HEAD_THRESHOLD = 0.8;

/**
 * True when at least 80% of the fingerprint occurs in the HEAD fingerprint set.
 * Invariant: a fingerprint that is a subset of `head` is always alive; an empty fingerprint never is.
 */
export function isAliveAtHead(fingerprint: number[], head: ReadonlySet<number>): boolean {
  if (fingerprint.length === 0) return false;
  let hit = 0;
  for (const h of fingerprint) if (head.has(h)) hit++;
  return hit / fingerprint.length >= ALIVE_AT_HEAD_THRESHOLD;
}

/**
 * Fingerprint a list of source lines with the shared normalizer, tokenizer and winnower.
 * Invariant: identical lines always give identical fingerprints.
 */
export function fingerprintLines(lines: string[], config: MatchConfig = DEFAULT_MINER_CONFIG): number[] {
  return kgramWinnow(normalizeBlock(lines, config), config);
}

/**
 * Slide a window of tombstone.lines.length lines (step 1) over the candidate and keep the best Jaccard.
 * Invariant: similarity and containment are in [0, 1]; embedding the tombstone's own lines in a longer candidate scores 1.
 */
export function matchWindowed(
  tombstone: Pick<Tombstone, 'lines' | 'fingerprint'>,
  candidateLines: string[],
  config: MatchConfig = DEFAULT_MINER_CONFIG,
): WindowedMatch {
  const none: WindowedMatch = { similarity: 0, matchedLines: [0, 0], containment: 0 };
  const size = tombstone.lines.length;
  if (size === 0 || candidateLines.length === 0 || tombstone.fingerprint.length === 0) return none;

  const width = Math.min(size, candidateLines.length);
  let best = none;
  let bestSim = 0;
  for (let start = 0; start + width <= candidateLines.length; start++) {
    const fp = fingerprintLines(candidateLines.slice(start, start + width), config);
    const sim = similarity(tombstone.fingerprint, fp);
    if (sim > bestSim) {
      bestSim = sim;
      best = {
        similarity: sim,
        matchedLines: [start + 1, start + width],
        containment: containment(tombstone.fingerprint, fp),
      };
    }
  }
  return best;
}
