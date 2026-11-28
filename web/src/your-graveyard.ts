import type { Obituary, Tombstone } from '../../src/core/types.ts';
import { DEFAULT_MINER_CONFIG } from '../../src/core/types.ts';
import { fingerprintLines } from '../../src/core/match.ts';
import { parseObituaryFile } from '../../src/core/obituary.ts';
import { stripGraveyard, type Fingerprinter, type WebTombstone } from '../scripts/strip.ts';

/** Largest file the page reads; a CLI graveyard of a very large repo is tens of MB at most. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export type Validation = { ok: true; tombstones: Tombstone[] } | { ok: false; reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isNumArray = (x: unknown): x is number[] => Array.isArray(x) && x.every(n => typeof n === 'number' && Number.isFinite(n));
const isDate = (x: unknown): boolean => isStr(x) && !Number.isNaN(Date.parse(x));

function tombstoneProblem(t: unknown): string | null {
  if (!isObj(t)) return 'is not an object';
  for (const k of ['id', 'path', 'language', 'commit', 'causeOfDeath'] as const) if (!isStr(t[k])) return `has no text field "${k}"`;
  if (!isDate(t['buriedAt'])) return 'has no valid "buriedAt" date';
  if (!isStrArray(t['lines'])) return '"lines" is not a list of text lines';
  if (!isNumArray(t['fingerprint'])) return '"fingerprint" is not a list of numbers';
  if (!Array.isArray(t['links']) || !t['links'].every(l => isObj(l) && isStr(l['type']) && isStr(l['ref']))) return '"links" is not a list of links';
  if (!Array.isArray(t['revivals'])) return '"revivals" is not a list';
  for (const r of t['revivals']) {
    if (!isObj(r) || !isStr(r['commit']) || !isDate(r['date']) || !isStr(r['subject']) || typeof r['similarity'] !== 'number' || typeof r['isRevert'] !== 'boolean') {
      return '"revivals" has an entry without commit, date, subject, similarity or isRevert';
    }
  }
  if (t['aliveAtHead'] !== undefined && typeof t['aliveAtHead'] !== 'boolean') return '"aliveAtHead" is not true or false';
  return null;
}

/**
 * Check that parsed JSON has the shape `deja-boo index` writes: an object with a `tombstones` list of well-formed records.
 * Invariant: ok only when every tombstone has the fields the page reads; never throws, whatever the input.
 */
export function validateGraveyard(json: unknown): Validation {
  if (!isObj(json)) return { ok: false, reason: 'the top level is not an object' };
  const list = json['tombstones'];
  if (!Array.isArray(list)) return { ok: false, reason: 'it has no "tombstones" list' };
  for (let i = 0; i < list.length; i++) {
    const p = tombstoneProblem(list[i]);
    if (p !== null) return { ok: false, reason: `tombstones[${i}] ${p}` };
  }
  return { ok: true, tombstones: list as Tombstone[] };
}

/** Fingerprints lines the way the miner (and `web:data`) does, from the browser-safe core. */
export const browserFingerprint: Fingerprinter = (lines, language) => fingerprintLines(lines, { ...DEFAULT_MINER_CONFIG, language });

/**
 * Convert a validated graveyard with the build script's stripping (`stripGraveyard`), after attaching obituaries by death commit like `web:data` does.
 * Invariant: equals `stripGraveyard` of the same tombstones with the same obituaries attached; the input is not mutated.
 */
export function toWebGraveyard(tombstones: Tombstone[], obituaries: Record<string, Obituary> | null, fingerprintOf: Fingerprinter = browserFingerprint): WebTombstone[] {
  const withObits = obituaries === null
    ? tombstones
    : tombstones.map(t => (obituaries[t.commit] !== undefined ? { ...t, obituary: obituaries[t.commit]! } : t));
  return stripGraveyard(withObits, fingerprintOf);
}

export type Parsed =
  | { kind: 'graveyard'; tombstones: Tombstone[] }
  | { kind: 'obituaries'; obituaries: Record<string, Obituary> }
  | { kind: 'error'; reason: string };

/** Read one dropped file's text: a graveyard (has `tombstones`) or an obituary file (`.deja-boo/obituaries.json`). Never throws. */
export function parseDropped(name: string, text: string): Parsed {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { kind: 'error', reason: `${name} is not valid JSON` }; }
  if (isObj(json) && 'tombstones' in json) {
    const v = validateGraveyard(json);
    return v.ok ? { kind: 'graveyard', tombstones: v.tombstones } : { kind: 'error', reason: `${name}: ${v.reason}` };
  }
  const obits = parseObituaryFile(json);
  if (obits !== null && Object.keys(obits).length > 0) return { kind: 'obituaries', obituaries: obits };
  return { kind: 'error', reason: `${name}: it has no "tombstones" list and is not an obituary file` };
}

/** Valid GitHub `owner/name`: owner 1-39 letters, digits or hyphens (no edge hyphen); name 1-100 of letters, digits, `.`, `_`, `-`, not `.` or `..`. */
export function parseGithubSlug(input: string): string | null {
  const s = input.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/.test(s)) return null;
  const name = s.split('/')[1]!;
  return name === '.' || name === '..' ? null : s;
}
