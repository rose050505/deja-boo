import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Graveyard, RevenantHit, WatchConfig } from '../core/types.js';
import { DEFAULT_MIN_HASHES } from '../core/types.js';
import { isSkippedPath, resolveSkipPatterns } from '../core/skip.js';
import { acknowledgedIds, findRevenants } from '../core/watch.js';
import { loadConfig, loadGraveyard } from '../watch/load.js';
import { git, gitShowHead } from '../watch/head.js';
import { formatEntries } from '../watch/format.js';

export interface StopResult { exitCode: 0; stdout: string }

export interface StopDeps {
  /** Changed (tracked diff vs HEAD plus untracked) paths relative to the event cwd; empty when not a git repo. */
  changedFiles(): string[];
  /** Text at HEAD, or undefined when the file is new at HEAD. */
  before(path: string): string | undefined;
  /** Working-tree text, or undefined when deleted, binary or too large. */
  after(path: string): string | undefined;
  graveyard: Graveyard | undefined;
  config: WatchConfig;
  /** Sorted-id key last blocked in this session, if any. */
  loadBlocked(sessionId: string): string | undefined;
  saveBlocked(sessionId: string, key: string): void;
}

const MAX_ENTRIES = 3;
const silent: StopResult = { exitCode: 0, stdout: '' };

/**
 * Block JSON when the working tree resurrects unacknowledged buried code, else empty output; always exit 0.
 * Invariant: the same session never gets the same set of tombstone ids blocked twice, and acknowledging every hit gives empty output.
 */
export function decideStop(sessionId: string, deps: StopDeps): StopResult {
  if (!deps.graveyard) return silent;
  const skip = resolveSkipPatterns();
  const hits: { hit: RevenantHit; file: string }[] = [];
  for (const file of deps.changedFiles()) {
    if (file.startsWith('.deja-boo/') || isSkippedPath(file, skip)) continue;
    const after = deps.after(file);
    if (after === undefined) continue;
    const before = deps.before(file) ?? '';
    if (before === after) continue;
    const acked = acknowledgedIds(after);
    for (const hit of findRevenants(deps.graveyard, after.split('\n'), deps.config.thresholds, before === '' ? [] : before.split('\n'), { minHashes: deps.config.minHashes ?? DEFAULT_MIN_HASHES })) {
      if (!acked.has(hit.tombstone.id)) hits.push({ hit, file });
    }
  }
  if (hits.length === 0) return silent;
  const key = [...new Set(hits.map(h => h.hit.tombstone.id))].sort().join(',');
  if (deps.loadBlocked(sessionId) === key) return silent;
  deps.saveBlocked(sessionId, key);
  const shown = formatEntries(hits.slice(0, MAX_ENTRIES));
  if (hits.length > MAX_ENTRIES) shown.push(`… and ${hits.length - MAX_ENTRIES} more buried things`);
  const reason = `${shown.join('\n')}\nThese changes resurrect buried code. Read the tombstone with get_tombstone; either take another approach or, if the cause no longer applies, add deja-boo: checked <id> near the code and explain why.`;
  return { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason }) + '\n' };
}

const MAX_FILE_BYTES = 1_000_000;
const STATE_FILE = '.deja-boo/stop-state.json';

/** Real git and filesystem access for `decideStop` in `cwd`. Invariant: never throws; failures read as "nothing changed". */
export function gitStopDeps(cwd: string): StopDeps {
  const stateFile = join(cwd, STATE_FILE);
  const readState = (): Record<string, string> => {
    try {
      const s = JSON.parse(readFileSync(stateFile, 'utf8')) as unknown;
      return typeof s === 'object' && s !== null && !Array.isArray(s) ? (s as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  return {
    changedFiles: () => {
      const tracked = git(cwd, ['diff', '--name-only', '--relative', '-z', 'HEAD']);
      if (tracked === undefined) return [];
      const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']) ?? '';
      return [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(f => f !== ''))].sort();
    },
    before: path => gitShowHead(cwd, path),
    after: path => {
      try {
        const buf = readFileSync(join(cwd, path));
        return buf.length > MAX_FILE_BYTES || buf.includes(0) ? undefined : buf.toString('utf8');
      } catch {
        return undefined;
      }
    },
    graveyard: loadGraveyard(cwd),
    config: loadConfig(cwd).config,
    loadBlocked: id => readState()[id],
    saveBlocked: (id, key) => {
      try {
        const s = readState();
        delete s[id];
        const keep = Object.entries(s).slice(-49);
        mkdirSync(join(cwd, '.deja-boo'), { recursive: true });
        writeFileSync(stateFile, JSON.stringify(Object.fromEntries([...keep, [id, key]]), null, 2) + '\n');
      } catch { /* a state write failure must never break the hook */ }
    },
  };
}
