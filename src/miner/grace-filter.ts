import type { MinerConfig, ParsedCommit, Tombstone } from '../core/types.js';
import { normalizeBlock } from '../core/normalize.js';
import { kgramWinnow } from '../core/fingerprint.js';
import { similarity } from '../core/match.js';
import { extractBlocks } from './block-extract.js';

/**
 * Return the ids of pending tombstones that should be dropped because the
 * commit re-adds the same code within the grace window.
 *
 * Invariant: a tombstone re-added at Jaccard ≥ moveThreshold within graceDays
 * always appears in the returned id list.
 */
export function applyGrace(
  pendingTombstones: Map<string, Tombstone>,
  commit: ParsedCommit,
  config: Pick<
    MinerConfig,
    | 'graceDays'
    | 'moveThreshold'
    | 'kgramSize'
    | 'windowSize'
    | 'renameIds'
    | 'minBlockLines'
  >,
): string[] {
  if (pendingTombstones.size === 0) return [];

  // Build the union added-fingerprint for this commit.
  const addedUnion = new Set<number>();
  for (const hunk of commit.hunks) {
    const addedBlocks = extractBlocks(hunk, 'added', config.minBlockLines);
    for (const block of addedBlocks) {
      const norm = normalizeBlock(block.lines, config);
      const fp = kgramWinnow(norm, config);
      for (const h of fp) addedUnion.add(h);
    }
  }
  if (addedUnion.size === 0) return [];

  const addedUnionArray = Array.from(addedUnion).sort((a, b) => a - b);
  // Use committerTimestamp (seconds) for date math to avoid non-monotonic author dates.
  const commitTimeMs = commit.meta.committerTimestamp * 1000;
  const toDrop: string[] = [];

  for (const [id, tombstone] of pendingTombstones) {
    // Grace window check (calendar days).
    const buriedTimeMs = tombstone.buriedAtTimestamp * 1000;
    // graceDays: 0 means the grace period is disabled entirely.
    if (config.graceDays <= 0) continue;
    const daysDiff = (commitTimeMs - buriedTimeMs) / 86_400_000;
    if (daysDiff < 0 || daysDiff > config.graceDays) continue;

    // Similarity check.
    const sim = similarity(tombstone.fingerprint, addedUnionArray);
    if (sim >= config.moveThreshold) {
      toDrop.push(id);
    }
  }

  return toDrop;
}
