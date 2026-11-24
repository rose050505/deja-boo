import { isRevertSubject } from '../core/revert.js';
import type { Graveyard, Link, ObituaryFile, Tombstone } from '../core/types.js';

/** A death commit to look up, with the links of its message. */
export interface CommitToLookUp {
  sha: string;
  links: Link[];
}

/** The `isWatched` rule of the web data step: not alive at HEAD, or a Revert. */
function watched(t: Tombstone): boolean {
  return t.aliveAtHead !== true || isRevertSubject(t.causeOfDeath);
}

/** 0 = Revert, 1 = revived, 2 = linked, -1 = not fetched. A tombstone belongs to its first matching group. */
function group(t: Tombstone): number {
  if (isRevertSubject(t.causeOfDeath)) return 0;
  if (t.revivals.length > 0) return 1;
  if (t.links.length > 0) return 2;
  return -1;
}

/**
 * Death commits worth asking GitHub about, in priority order: watched tombstones of group Revert, revived, linked; newest first, ties by id; one entry per distinct commit; commits already in `existing` left out.
 * Invariant: deterministic and independent of the input order; no sha twice; no sha that is in `existing`.
 */
export function selectCommits(graveyard: Pick<Graveyard, 'tombstones'>, existing: ObituaryFile): CommitToLookUp[] {
  const ranked = graveyard.tombstones
    .filter(t => watched(t) && group(t) >= 0)
    .sort((a, b) => group(a) - group(b) || b.buriedAtTimestamp - a.buriedAtTimestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set<string>();
  const out: CommitToLookUp[] = [];
  for (const t of ranked) {
    if (seen.has(t.commit) || Object.hasOwn(existing, t.commit)) continue;
    seen.add(t.commit);
    out.push({ sha: t.commit, links: t.links });
  }
  return out;
}
