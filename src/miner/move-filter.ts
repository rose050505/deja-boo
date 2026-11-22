import type { RawBlock, MinerConfig } from '../core/types.js';
import { normalizeBlock } from '../core/normalize.js';
import { kgramWinnow } from '../core/fingerprint.js';
import { similarity } from '../core/match.js';

/**
 * Remove deleted blocks that were also added elsewhere in the same commit (i.e. moved).
 *
 * Algorithm:
 *   1. Fingerprint each added block; union all hashes into one set.
 *   2. For each deleted block, compute Jaccard similarity against the union.
 *   3. If similarity ≥ moveThreshold, discard (it was moved, not dead).
 *
 * Invariant: an exact copy (Jaccard = 1.0) is always excluded for any threshold ≤ 1.0.
 */
export function filterMoved(
  deleted: RawBlock[],
  added: RawBlock[],
  config: Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize' | 'moveThreshold'>,
): RawBlock[] {
  const { moveThreshold } = config;

  // Build the commit-level union fingerprint from all added blocks.
  const addedUnion = new Set<number>();
  for (const block of added) {
    const normalized = normalizeBlock(block.lines, config);
    const fp = kgramWinnow(normalized, config);
    for (const h of fp) addedUnion.add(h);
  }
  const addedUnionArray = Array.from(addedUnion).sort((a, b) => a - b);

  // Keep only deleted blocks that do NOT match the added-union at or above the threshold.
  return deleted.filter(block => {
    const normalized = normalizeBlock(block.lines, config);
    const fp = kgramWinnow(normalized, config);
    if (fp.length === 0) return true; // empty fingerprint — keep (build-tombstone will drop it)
    const sim = similarity(fp, addedUnionArray);
    return sim < moveThreshold;
  });
}
