import type { Tombstone } from './types.js';

export type HauntLevel = 'none' | 'warn' | 'block';

/** Default thresholds, from research/matching-eval.md. */
export const WARN_THRESHOLD = 0.5;
export const BLOCK_THRESHOLD = 0.7;

/**
 * Decide how loudly to haunt: warn at >= 0.5; block at >= 0.7 only with a Revert or an issue/PR link, else warn.
 * Invariant: never returns 'block' without evidence, and always returns 'none' for tombstones alive at HEAD.
 */
export function hauntLevel(
  tombstone: Pick<Tombstone, 'aliveAtHead' | 'causeOfDeath' | 'links'>,
  similarity: number,
): HauntLevel {
  if (tombstone.aliveAtHead === true) return 'none';
  if (similarity < WARN_THRESHOLD) return 'none';
  const hasEvidence = /^revert\b/i.test(tombstone.causeOfDeath) || tombstone.links.length > 0;
  return similarity >= BLOCK_THRESHOLD && hasEvidence ? 'block' : 'warn';
}
