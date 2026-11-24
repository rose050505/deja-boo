import { isRevertCause } from '../core/level.js';
import type { GraveyardStats, Tombstone } from '../core/types.js';

/**
 * Compute graveyard-level statistics from a finalized tombstone array.
 * Revivals are counted per event: records with the same patchId (or, without one, the same commit) are one event, however many tombstones they revive.
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
  let aliveAtHeadReverts = 0;
  /** One entry per revival event (same patch = same event), with its smallest burial-to-revival gap. */
  const events = new Map<string, { gap: number; isRevert: boolean; merge: boolean }>();

  for (const t of tombstones) {
    if (t.aliveAtHead === true) {
      aliveAtHead++;
      if (isRevertCause(t.causeOfDeath)) aliveAtHeadReverts++;
    }
    for (const r of t.revivals) {
      // Use buriedAtTimestamp for the death side; revival date is derived from committerTimestamp.
      const gap = Math.floor((Date.parse(r.date) - t.buriedAtTimestamp * 1000) / 86_400_000);
      const key = r.patchId ?? r.commit;
      const known = events.get(key);
      if (known) known.gap = Math.min(known.gap, gap);
      else events.set(key, { gap, isRevert: r.isRevert, merge: r.isMergeArtifact });
    }
  }

  const gaps: number[] = [];
  for (const e of events.values()) {
    if (e.merge) {
      mergeArtifactRevivals++;
      if (opts.includeMergeArtifacts !== true) continue;
    }
    revivals++;
    if (e.isRevert) revivalsViaRevert++;
    gaps.push(e.gap);
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
    aliveAtHeadReverts,
    medianRevivalGapDays,
  };
}
