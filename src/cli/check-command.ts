import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { isSkippedPath, resolveSkipPatterns } from '../core/skip.js';
import { findRevenants } from '../core/watch.js';
import { loadConfig, loadGraveyard } from '../watch/load.js';
import { formatCheckReport } from '../watch/format.js';

export interface CheckResult { exitCode: 0 | 1 | 2 | 3; stdout: string; stderr: string }

/**
 * Check `code` (from `path`, if known) against the graveyard in `cwd`.
 * Invariant: exit 0 without revenants, 1 when the highest level is warn, 2 for block, 3 when the graveyard is missing.
 */
export function runCheck(code: string, path: string | undefined, cwd: string): CheckResult {
  const graveyard = loadGraveyard(cwd);
  if (!graveyard) {
    return { exitCode: 3, stdout: '', stderr: 'deja-boo: no graveyard at .deja-boo/graveyard.json. Create it with: deja-boo index . --out .deja-boo/graveyard.json\n' };
  }
  const { config, notes } = loadConfig(cwd);
  const stderr = notes.map(n => `deja-boo: ${n}\n`).join('');
  if (path !== undefined && isSkippedPath(path, resolveSkipPatterns())) return { exitCode: 0, stdout: '', stderr };
  const hits = findRevenants(graveyard, code.split('\n'), config.thresholds);
  const exitCode = hits.some(h => h.level === 'block') ? 2 : hits.length > 0 ? 1 : 0;
  return { exitCode, stdout: formatCheckReport(hits), stderr };
}

/** Entry point for `deja-boo check <file|->`. */
export function runCheckCommand(argv: string[]): void {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const target = positionals[0];
  if (target === undefined) {
    process.stderr.write('deja-boo: usage: deja-boo check <file|->\n');
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
  const r = runCheck(code, target === '-' ? undefined : target, process.cwd());
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;
}
