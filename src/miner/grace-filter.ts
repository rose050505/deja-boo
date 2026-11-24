import type { MinerConfig, ParsedCommit, Tombstone } from '../core/types.js';
import { containedIn } from '../core/match.js';
import { changedRuns, unionGrams } from './commit-grams.js';

/**
 * Return the ids of pending tombstones that should be dropped because the
 * commit re-adds the same code within the grace window.
 *
 * "Re-adds" means at least aliveAfterDeath of the tombstone's fingerprint is contained in the k-grams of all lines
 * the commit adds, of any size and in any file: the same test as the move filter, one week later. An edited variant
 * (a flag or kwarg changed) keeps less than that and is not churn.
 *
 * Invariant: a tombstone whose lines are all added again within graceDays always appears in the returned id list.
 */
export function applyGrace(
  pendingTombstones: Map<string, Tombstone>,
  commit: ParsedCommit,
  config: Pick<
    MinerConfig,
    'graceDays' | 'aliveAfterDeath' | 'kgramSize' | 'windowSize' | 'renameIds'
  >,
): string[] {
  if (pendingTombstones.size === 0) return [];
  // graceDays: 0 means the grace period is disabled entirely.
  if (config.graceDays <= 0) return [];

  const addedGrams = unionGrams(changedRuns(commit, 'added'), config);
  if (addedGrams.size === 0) return [];

  // Use committerTimestamp (seconds) for date math to avoid non-monotonic author dates.
  const commitTimeMs = commit.meta.committerTimestamp * 1000;
  const toDrop: string[] = [];

  for (const [id, tombstone] of pendingTombstones) {
    // Grace window check (calendar days).
    const buriedTimeMs = tombstone.buriedAtTimestamp * 1000;
    const daysDiff = (commitTimeMs - buriedTimeMs) / 86_400_000;
    if (daysDiff < 0 || daysDiff > config.graceDays) continue;

    if (containedIn(tombstone.fingerprint, addedGrams) >= config.aliveAfterDeath) toDrop.push(id);
  }

  return toDrop;
}
