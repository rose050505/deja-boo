import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Graveyard, ObituaryFile, Thresholds, WatchConfig } from '../core/types.js';
import { parseObituaryFile } from '../core/obituary.js';
import { DEFAULT_MIN_HASHES } from '../core/types.js';
import { BLOCK_THRESHOLD, WARN_THRESHOLD } from '../core/level.js';
import { fromGraveyardJson } from '../miner/serialize.js';

export const GRAVEYARD_FILE = '.deja-boo/graveyard.json';
export const OBITUARY_FILE = '.deja-boo/obituaries.json';
export const CONFIG_FILE = '.deja-boo/config.json';

export const DEFAULT_THRESHOLDS: Thresholds = { warn: WARN_THRESHOLD, block: BLOCK_THRESHOLD };

/** True when 0 < warn <= block <= 1 and both are finite numbers. Invariant: false for any non-number. */
export function validThresholds(t: unknown): t is Thresholds {
  if (typeof t !== 'object' || t === null) return false;
  const { warn, block } = t as Record<string, unknown>;
  return typeof warn === 'number' && typeof block === 'number' && Number.isFinite(warn) && Number.isFinite(block)
    && warn > 0 && warn <= block && block <= 1;
}

/**
 * Read `<cwd>/.deja-boo/config.json`; defaults when missing, and defaults plus a note when invalid.
 * `minHashes` (a non-negative integer, default 4) is the fewest distinct hashes a tombstone needs to be watched.
 * Invariant: the returned thresholds always satisfy 0 < warn <= block <= 1, and minHashes is a non-negative integer.
 */
export function loadConfig(cwd: string): { config: WatchConfig; notes: string[] } {
  const fallback: WatchConfig = { thresholds: { ...DEFAULT_THRESHOLDS }, minHashes: DEFAULT_MIN_HASHES };
  const file = join(cwd, CONFIG_FILE);
  if (!existsSync(file)) return { config: fallback, notes: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { config: fallback, notes: [`${CONFIG_FILE} is not valid JSON; using the default thresholds.`] };
  }
  const obj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const t = obj['thresholds'];
  const m = obj['minHashes'];
  const config: WatchConfig = { thresholds: { ...DEFAULT_THRESHOLDS }, minHashes: DEFAULT_MIN_HASHES };
  const notes: string[] = [];
  if (t !== undefined) {
    if (validThresholds(t)) config.thresholds = { warn: t.warn, block: t.block };
    else notes.push(`${CONFIG_FILE}: thresholds must be numbers with 0 < warn <= block <= 1; using the defaults.`);
  }
  if (m !== undefined) {
    if (typeof m === 'number' && Number.isInteger(m) && m >= 0) config.minHashes = m;
    else notes.push(`${CONFIG_FILE}: minHashes must be a non-negative integer; using ${DEFAULT_MIN_HASHES}.`);
  }
  return { config, notes };
}

/** One stderr line for a missing graveyard, shared by the hook, `check` and the MCP server. */
export const NO_GRAVEYARD = `no graveyard at ${GRAVEYARD_FILE}. Create it by running \`deja-boo index\` in the repository root.`;

/**
 * Read `<cwd>/.deja-boo/obituaries.json`: `file` is null when it is missing, unreadable or invalid; an invalid file adds one note.
 * Invariant: a missing file gives `{ file: null, notes: [] }`; a returned file has only valid entries.
 */
export function loadObituaries(cwd: string): { file: ObituaryFile | null; notes: string[] } {
  const path = join(cwd, OBITUARY_FILE);
  if (!existsSync(path)) return { file: null, notes: [] };
  try {
    const file = parseObituaryFile(JSON.parse(readFileSync(path, 'utf8')));
    if (file !== null) return { file, notes: [] };
  } catch { /* reported below */ }
  return { file: null, notes: [`${OBITUARY_FILE} is not a valid obituary file; ignoring it.`] };
}

/**
 * Read `<cwd>/.deja-boo/graveyard.json` and attach each tombstone's obituary (matched by death commit) in memory; undefined when missing, unreadable or not a graveyard.
 * Invariant: without a valid obituary file the result is exactly the parsed graveyard; the file never changes anything but `obituary`.
 */
export function loadGraveyard(cwd: string): Graveyard | undefined {
  let g: Graveyard | undefined;
  try {
    g = fromGraveyardJson(readFileSync(join(cwd, GRAVEYARD_FILE), 'utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(g?.tombstones)) return undefined;
  const { file } = loadObituaries(cwd);
  if (file === null) return g;
  for (const t of g.tombstones) {
    const o = file[t.commit];
    if (o !== undefined) t.obituary = o;
  }
  return g;
}
