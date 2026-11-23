import type { GraveyardStats, Tombstone } from '../core/types.js';

/**
 * Compute graveyard-level statistics from a finalized tombstone array.
 * Merge-artifact revivals are excluded from `revivals` unless includeMergeArtifacts is set.
 * Invariant: medianRevivalGapDays is null iff counted revivals === 0.
 */
export function computeStats(
  tombstones: Tombstone[],
  commitsWalked: number,
  opts: { includeMergeArtifacts?: boolean } = {},
): GraveyardStats {
  let revivals = 0;
  let revivalsViaRevert = 0;
  let mergeArtifactRevivals = 0;
  let aliveAtHead = 0;
  const gaps: number[] = [];

  for (const t of tombstones) {
    if (t.aliveAtHead === true) aliveAtHead++;
    for (const r of t.revivals) {
      if (r.isMergeArtifact) {
        mergeArtifactRevivals++;
        if (opts.includeMergeArtifacts !== true) continue;
      }
      revivals++;
      if (r.isRevert) revivalsViaRevert++;
      // Use buriedAtTimestamp for the death side; revival date is derived from committerTimestamp.
      const buriedMs = t.buriedAtTimestamp * 1000;
      const revivedMs = Date.parse(r.date);
      gaps.push(Math.floor((revivedMs - buriedMs) / 86_400_000));
    }
  }

  let medianRevivalGapDays: number | null = null;
  if (gaps.length > 0) {
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    if (gaps.length % 2 === 1) {
      medianRevivalGapDays = gaps[mid]!;
    } else {
      medianRevivalGapDays = Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
    }
  }

  return {
    commits: commitsWalked,
    tombstones: tombstones.length,
    revivals,
    revivalsViaRevert,
    mergeArtifactRevivals,
    aliveAtHead,
    medianRevivalGapDays,
  };
}
