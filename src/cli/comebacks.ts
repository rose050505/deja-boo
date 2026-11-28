import type { RevivalRecord, Tombstone } from '../core/types.js';

/** How many comebacks `index` prints. */
export const MAX_COMEBACKS = 5;

export const NO_COMEBACKS = 'No comebacks found in history.';

export const NEXT_STEP =
  'Next: deja-boo check <file> · hooks: see README "Use it on your repo" · view it: drop .deja-boo/graveyard.json on https://rose050505.github.io/deja-boo/';

export interface Comeback {
  tombstone: Tombstone;
  revival: RevivalRecord;
}

/**
 * One comeback per revival event (same patch = same event, merge artifacts left out, like the counter), newest first, at most `limit`.
 * Invariant: the result is sorted by revival date descending, has no two entries with the same patch, and is empty iff no counted revival exists.
 */
export function newestComebacks(tombstones: Tombstone[], limit = MAX_COMEBACKS): Comeback[] {
  const events = new Map<string, Comeback>();
  for (const t of tombstones) {
    for (const r of t.revivals) {
      if (r.isMergeArtifact) continue;
      const key = r.patchId ?? r.commit;
      const known = events.get(key);
      // Same event on several tombstones: show the closest match, then the earlier tombstone id, so the choice is stable.
      if (known === undefined || r.similarity > known.revival.similarity || (r.similarity === known.revival.similarity && t.id < known.tombstone.id)) {
        events.set(key, { tombstone: t, revival: r });
      }
    }
  }
  return [...events.values()]
    .sort((a, b) => Date.parse(b.revival.date) - Date.parse(a.revival.date) || (a.revival.commit < b.revival.commit ? -1 : a.revival.commit > b.revival.commit ? 1 : 0))
    .slice(0, limit);
}

/** First line of a cause of death, verbatim; "cause of death unknown" when it is empty. */
export function firstCauseLine(cause: string): string {
  const line = cause.split(/\r\n|\r|\n/).find(l => l.trim() !== '');
  return line === undefined ? 'cause of death unknown' : line.trim();
}

/**
 * The text printed after the counters: up to 5 comebacks, then the next-step line.
 * Invariant: the last line is NEXT_STEP; with no counted revival the first line is NO_COMEBACKS.
 */
export function summaryLines(tombstones: Tombstone[]): string[] {
  const list = newestComebacks(tombstones);
  const out: string[] = [''];
  if (list.length === 0) {
    out.push(NO_COMEBACKS);
  } else {
    out.push(`Comebacks found in history (newest first, up to ${MAX_COMEBACKS}):`);
    for (const { tombstone: t, revival: r } of list) {
      out.push(`  ${t.path}`);
      out.push(`    died ${t.buriedAt.slice(0, 10)}: ${firstCauseLine(t.causeOfDeath)}`);
      out.push(`    back ${r.date.slice(0, 10)} in ${r.commit.slice(0, 8)}${r.isRevert ? ' via Revert' : ''}`);
    }
  }
  out.push('', NEXT_STEP);
  return out;
}
