import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Graveyard, Thresholds, WatchConfig } from '../core/types.js';
import { BLOCK_THRESHOLD, WARN_THRESHOLD } from '../core/level.js';
import { fromGraveyardJson } from '../miner/serialize.js';

export const GRAVEYARD_FILE = '.deja-boo/graveyard.json';
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
 * Invariant: the returned thresholds always satisfy 0 < warn <= block <= 1.
 */
export function loadConfig(cwd: string): { config: WatchConfig; notes: string[] } {
  const fallback: WatchConfig = { thresholds: { ...DEFAULT_THRESHOLDS } };
  const file = join(cwd, CONFIG_FILE);
  if (!existsSync(file)) return { config: fallback, notes: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { config: fallback, notes: [`${CONFIG_FILE} is not valid JSON; using the default thresholds.`] };
  }
  const t = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['thresholds'] : undefined;
  if (t === undefined) return { config: fallback, notes: [] };
  if (!validThresholds(t)) {
    return { config: fallback, notes: [`${CONFIG_FILE}: thresholds must be numbers with 0 < warn <= block <= 1; using the defaults.`] };
  }
  return { config: { thresholds: { warn: t.warn, block: t.block } }, notes: [] };
}

/** Read `<cwd>/.deja-boo/graveyard.json`; undefined when missing, unreadable or not a graveyard. */
export function loadGraveyard(cwd: string): Graveyard | undefined {
  try {
    const g = fromGraveyardJson(readFileSync(join(cwd, GRAVEYARD_FILE), 'utf8'));
    return Array.isArray(g?.tombstones) ? g : undefined;
  } catch {
    return undefined;
  }
}
