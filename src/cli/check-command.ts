import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { isSkippedPath, resolveSkipPatterns } from '../core/skip.js';
import { findRevenants } from '../core/watch.js';
import { DEFAULT_MIN_HASHES } from '../core/types.js';
import { loadConfig, loadGraveyard, loadObituaries, NO_GRAVEYARD } from '../watch/load.js';
import { headVersionOf } from '../watch/head.js';
import { formatCheckReport } from '../watch/format.js';

export interface CheckResult { exitCode: 0 | 1 | 2 | 3; stdout: string; stderr: string }

/**
 * Check `code` (from `path`, if known) against the graveyard in `cwd`.
 * For a path inside the repository, HEAD's version of that path is the `before` text (unless `head` is false), so code that is
 * already at HEAD does not alarm and only what the new text makes worse is reported.
 * When nothing is found, stderr ends with one line saying what was checked; stdout and exit codes are unchanged.
 * Invariant: exit 0 without revenants, 1 when the highest level is warn, 2 for block, 3 when the graveyard is missing; `code` equal to HEAD's version of `path` is always exit 0.
 */
export function runCheck(code: string, path: string | undefined, cwd: string, opts: { head?: boolean } = {}): CheckResult {
  const graveyard = loadGraveyard(cwd);
  if (!graveyard) {
    return { exitCode: 3, stdout: '', stderr: `deja-boo: ${NO_GRAVEYARD}\n` };
  }
  const { config, notes } = loadConfig(cwd);
  const obituaries = loadObituaries(cwd);
  const stderr = [...notes, ...obituaries.notes].map(n => `deja-boo: ${n}\n`).join('');
  if (path !== undefined && isSkippedPath(path, resolveSkipPatterns())) {
    return { exitCode: 0, stdout: '', stderr: `${stderr}\u2713 clean: ${path} is on the skip list, not checked\n` };
  }
  const atHead = path !== undefined && opts.head !== false ? headVersionOf(cwd, path) : undefined;
  const before = atHead === undefined ? undefined : atHead === '' ? [] : atHead.split('\n');
  const hits = findRevenants(graveyard, code.split('\n'), config.thresholds, before, { minHashes: config.minHashes ?? DEFAULT_MIN_HASHES });
  const exitCode = hits.some(h => h.level === 'block') ? 2 : hits.length > 0 ? 1 : 0;
  const clean = hits.length === 0
    ? `\u2713 clean: ${path === undefined ? 'input from stdin' : atHead === undefined ? `${path} (whole text, no HEAD comparison)` : path} checked against ${graveyard.tombstones.length} tombstones${path !== undefined && atHead !== undefined ? ' (compared with HEAD)' : ''}\n`
    : '';
  return { exitCode, stdout: formatCheckReport(hits, obituaries.file), stderr: stderr + clean };
}

/** Entry point for `deja-boo check [--no-head] <file|->`. */
export function runCheckCommand(argv: string[]): void {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { 'no-head': { type: 'boolean', default: false } } });
  const target = positionals[0];
  if (target === undefined) {
    process.stderr.write('deja-boo: usage: deja-boo check [--no-head] <file|->\n');
    process.exitCode = 3;
    return;
  }
  let code: string;
  try {
    code = readFileSync(target === '-' ? 0 : target, 'utf8');
  } catch (err) {
    process.stderr.write(`deja-boo: cannot read ${target}: ${String(err)}\n`);
    process.exitCode = 3;
    return;
  }
  const r = runCheck(code, target === '-' ? undefined : target, process.cwd(), { head: values['no-head'] !== true });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;
}
