import type { Graveyard, Link, Thresholds, Tombstone } from '../core/types.js';
import { isSkippedPath, resolveSkipPatterns } from '../core/skip.js';
import { findRevenants } from '../core/watch.js';
import { causeText } from '../watch/format.js';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

/** A tool failure the server reports as an MCP error result. */
export class ToolError extends Error {}

export interface RevenantInfo {
  id: string;
  level: 'warn' | 'block';
  similarity: number;
  containment: number;
  matchedLines: [number, number];
  path: string;
  commit: string;
  buriedAt: string;
  causeOfDeath: string;
  links: Link[];
}

export interface CheckSnippetResult { level: 'none' | 'warn' | 'block'; revenants: RevenantInfo[] }

export interface TombstoneSummary {
  id: string;
  path: string;
  buriedAt: string;
  commit: string;
  causeOfDeath: string;
  links: Link[];
  lineCount: number;
  aliveAtHead: boolean;
}

/**
 * Match `code` like `deja-boo check`: same findRevenants, whole input counts as added; a skipped `path` gives level none.
 * Invariant: `level` is the highest level among `revenants`, and 'none' exactly when there are none.
 */
export function checkSnippet(graveyard: Graveyard, thresholds: Thresholds, code: string, path?: string): CheckSnippetResult {
  if (path !== undefined && isSkippedPath(path, resolveSkipPatterns())) return { level: 'none', revenants: [] };
  const revenants = findRevenants(graveyard, code.split('\n'), thresholds).map((h): RevenantInfo => ({
    id: h.tombstone.id,
    level: h.level,
    similarity: h.similarity,
    containment: h.containment,
    matchedLines: h.matchedLines,
    path: h.tombstone.path,
    commit: h.tombstone.commit,
    buriedAt: h.tombstone.buriedAt,
    causeOfDeath: causeText(h.tombstone),
    links: h.tombstone.links,
  }));
  return { level: revenants.some(r => r.level === 'block') ? 'block' : revenants.length > 0 ? 'warn' : 'none', revenants };
}

/** The full tombstone with an empty cause shown as "cause of death unknown". Throws ToolError `no tombstone with id <id>`. Invariant: only graveyard fields are returned. */
export function getTombstone(graveyard: Graveyard, id: string): Tombstone {
  const t = graveyard.tombstones.find(x => x.id === id);
  if (!t) throw new ToolError(`no tombstone with id ${id}`);
  return { ...t, causeOfDeath: causeText(t), aliveAtHead: t.aliveAtHead ?? false };
}

/** Tombstone summaries, newest first (ties by id), filtered by path prefix. Invariant: length <= min(limit, 100), sorted newest first. */
export function listGraveyard(graveyard: Graveyard, opts: { limit?: number | undefined; path?: string | undefined } = {}): TombstoneSummary[] {
  const raw = opts.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LIST_LIMIT));
  const dir = opts.path === undefined ? undefined : opts.path.replace(/\/+$/, '');
  return graveyard.tombstones
    .filter(t => dir === undefined || t.path === dir || t.path.startsWith(`${dir}/`))
    .sort((a, b) => b.buriedAtTimestamp - a.buriedAtTimestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map(t => ({
      id: t.id, path: t.path, buriedAt: t.buriedAt, commit: t.commit, causeOfDeath: causeText(t),
      links: t.links, lineCount: t.lines.length, aliveAtHead: t.aliveAtHead ?? false,
    }));
}
