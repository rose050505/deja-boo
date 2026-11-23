import type { Link, RevivalRecord, Tombstone } from '../../src/core/types.ts';
import { isRevertCause } from '../../src/core/level.ts';

/** Maximum deleted lines kept per tombstone in the web graveyard. */
export const MAX_LINES = 60;

/** The web record: a tombstone reduced to what the browser needs. */
export interface WebTombstone {
  id: string;
  path: string;
  language: string;
  buriedAt: string;
  commit: string;
  causeOfDeath: string;
  links: Link[];
  lines: string[];
  fingerprint: number[];
  revivals: RevivalRecord[];
  aliveAtHead?: boolean;
  /** True line count; present only when `lines` was capped. */
  totalLines?: number;
}

export type Fingerprinter = (lines: string[]) => number[];

/**
 * Keep a tombstone in the web graveyard unless it is alive at HEAD without a Revert cause (hauntLevel ignores those).
 * Invariant: a kept tombstone is never `aliveAtHead` unless its cause of death is a Revert.
 */
export function isWatched(t: Pick<Tombstone, 'aliveAtHead' | 'causeOfDeath'>): boolean {
  return t.aliveAtHead !== true || isRevertCause(t.causeOfDeath);
}

/**
 * Reduce a tombstone to the web fields; cap `lines` at MAX_LINES and fingerprint the kept lines so window size and fingerprint agree.
 * Invariant: lines.length <= MAX_LINES; an uncapped tombstone keeps its fingerprint unchanged and has no `totalLines`.
 */
export function stripTombstone(t: Tombstone, fingerprintOf: Fingerprinter): WebTombstone {
  const capped = t.lines.length > MAX_LINES;
  const lines = capped ? t.lines.slice(0, MAX_LINES) : t.lines;
  const out: WebTombstone = {
    id: t.id,
    path: t.path,
    language: t.language,
    buriedAt: t.buriedAt,
    commit: t.commit,
    causeOfDeath: t.causeOfDeath,
    links: t.links,
    lines,
    fingerprint: capped ? fingerprintOf(lines).slice().sort((a, b) => a - b) : t.fingerprint,
    revivals: t.revivals,
  };
  if (t.aliveAtHead === true) out.aliveAtHead = true;
  if (capped) out.totalLines = t.lines.length;
  return out;
}

/**
 * Strip a whole graveyard: drop unwatched tombstones, then order by buriedAt then id.
 * Invariant: deterministic; output ids are a subset of input ids with no duplicates.
 */
export function stripGraveyard(tombstones: Tombstone[], fingerprintOf: Fingerprinter): WebTombstone[] {
  return tombstones
    .filter(isWatched)
    .map(t => stripTombstone(t, fingerprintOf))
    .sort((a, b) => (a.buriedAt < b.buriedAt ? -1 : a.buriedAt > b.buriedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
