import type { GraveyardStats, Tombstone } from '../core/types.js';

/**
 * Compute graveyard-level statistics from a finalized tombstone array.
 * Invariant: medianRevivalGapDays is null iff total revivals === 0.
 */
export function computeStats(
  tombstones: Tombstone[],
  commitsWalked: number,
): GraveyardStats {
  let revivals = 0;
  let revivalsViaRevert = 0;
  const gaps: number[] = [];

  for (const t of tombstones) {
    for (const r of t.revivals) {
      revivals++;
      if (r.isRevert) revivalsViaRevert++;
      const buried = Date.parse(t.buriedAt);
      const revived = Date.parse(r.date);
      gaps.push(Math.floor((revived - buried) / 86_400_000));
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
    medianRevivalGapDays,
  };
}
