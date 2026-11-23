import type { Graveyard, RevenantHit, Thresholds, Tombstone } from '../../src/core/types.ts';
import { findRevenants, acknowledgedIds } from '../../src/core/watch.ts';
import { BLOCK_THRESHOLD, WARN_THRESHOLD } from '../../src/core/level.ts';
import type { WebTombstone } from './data.ts';

export const THRESHOLDS: Thresholds = { warn: WARN_THRESHOLD, block: BLOCK_THRESHOLD };

export interface SummonResult {
  /** Hits that rise: not acknowledged. Sorted by similarity desc, id asc. */
  hits: RevenantHit[];
  /** Hits the pasted text lets rest with `deja-boo: checked <id>`. */
  rested: RevenantHit[];
}

/**
 * Run the shared matcher over pasted code.
 * Invariant: hits and rested are disjoint; acknowledging every hit's id yields no hits; the levels come only from hauntLevel via findRevenants.
 */
export function summon(tombstones: readonly WebTombstone[], text: string, thresholds: Thresholds = THRESHOLDS): SummonResult {
  // The web record carries every field that matching reads (id, lines, fingerprint, causeOfDeath, links, aliveAtHead).
  const graveyard = { tombstones: tombstones as unknown as Tombstone[], stats: {} } as unknown as Graveyard;
  const all = findRevenants(graveyard, text.split('\n'), thresholds);
  const ack = acknowledgedIds(text);
  return { hits: all.filter(h => !ack.has(h.tombstone.id)), rested: all.filter(h => ack.has(h.tombstone.id)) };
}

/** The sentence every hit ends with. */
export const restLine = (id: string): string => `If the reason no longer applies, let it rest: add \`deja-boo: checked ${id}\``;

/** Opacity of a ghost for a similarity in [0, 1]; never fully invisible. Invariant: monotone, within [0.25, 1]. */
export const ghostOpacity = (similarity: number): number => Math.min(1, Math.max(0.25, similarity));

/** Fog density in [0, 0.7] from the number of active hits. Invariant: monotone in `count`. */
export const fogDensity = (count: number): number => Math.min(0.7, count * 0.2);
