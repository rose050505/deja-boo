import type { Thresholds, Tombstone } from './types.js';

export type HauntLevel = 'none' | 'warn' | 'block';

/** Default thresholds, from research/matching-eval.md. */
export const WARN_THRESHOLD = 0.5;
export const BLOCK_THRESHOLD = 0.7;

/** True when the cause of death starts with "Revert" (case-insensitive). */
export function isRevertCause(causeOfDeath: string): boolean {
  return /^revert/i.test(causeOfDeath);
}

/**
 * Decide how loudly to haunt: warn at >= 0.5; block at >= 0.7 only with a Revert or an issue/PR link, else warn.
 * Tombstones alive at HEAD are suppressed unless their cause of death starts with "Revert" (case-insensitive);
 * a reverted variant often overlaps the surviving code, so it is judged by similarity.
 * `thresholds` defaults to the constants above. Invariant: raising either threshold never raises the level; never returns 'block' without evidence; 'none' for every aliveAtHead non-Revert tombstone; an aliveAtHead Revert tombstone at similarity >= 0.7 returns 'block'.
 */
export function hauntLevel(
  tombstone: Pick<Tombstone, 'aliveAtHead' | 'causeOfDeath' | 'links'>,
  similarity: number,
  thresholds: Thresholds = { warn: WARN_THRESHOLD, block: BLOCK_THRESHOLD },
): HauntLevel {
  if (tombstone.aliveAtHead === true && !isRevertCause(tombstone.causeOfDeath)) return 'none';
  if (similarity < thresholds.warn) return 'none';
  const hasEvidence = /^revert\b/i.test(tombstone.causeOfDeath) || tombstone.links.length > 0;
  return similarity >= thresholds.block && hasEvidence ? 'block' : 'warn';
}
