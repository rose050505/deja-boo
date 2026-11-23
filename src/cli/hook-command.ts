import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Graveyard, WatchConfig } from '../core/types.js';
import { isSkippedPath, resolveSkipPatterns } from '../core/skip.js';
import { acknowledgedIds, addedLineNumbers, findRevenants } from '../core/watch.js';
import { loadConfig, loadGraveyard } from '../watch/load.js';
import { formatHookMessage } from '../watch/format.js';

export interface HookResult { exitCode: 0 | 1 | 2; stderr: string }

export interface HookDeps {
  /** Text of the file at an absolute path, or undefined when it does not exist. */
  readFile(path: string): string | undefined;
  graveyard: Graveyard | undefined;
  config: WatchConfig;
}

const ok: HookResult = { exitCode: 0, stderr: '' };
const bad = (reason: string): HookResult => ({ exitCode: 1, stderr: `deja-boo: ${reason}\n` });

const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Exit code is 0 iff no unacknowledged revenant exists in the new code (for a valid event); 1 for a broken event or setup; 2 otherwise.
 * Invariant: acknowledging every matched id always gives exit 0.
 */
export function decideHook(rawEvent: string, deps: HookDeps): HookResult {
  let event: unknown;
  try {
    event = JSON.parse(rawEvent);
  } catch {
    return bad('hook event is not valid JSON; not checking this write.');
  }
  if (typeof event !== 'object' || event === null) return bad('hook event is not a JSON object; not checking this write.');
  const e = event as Record<string, unknown>;
  const input = e['tool_input'];
  if (!isStr(e['tool_name'])) return bad('hook event has no tool_name; not checking this write.');
  const tool = e['tool_name'];
  if (tool !== 'fs_write' && tool !== 'str_replace') return ok;
  if (typeof input !== 'object' || input === null) return bad('hook event has no tool_input; not checking this write.');
  const ti = input as Record<string, unknown>;
  const cwd = isStr(e['cwd']) ? e['cwd'] : process.cwd();
  if (!isStr(ti['path'])) return bad('hook event has no tool_input.path; not checking this write.');
  const abs = isAbsolute(ti['path']) ? ti['path'] : resolve(cwd, ti['path']);
  const rel = relative(cwd, abs);
  if (isSkippedPath(rel.startsWith('..') ? abs : rel, resolveSkipPatterns())) return ok;

  const disk = deps.readFile(abs) ?? '';
  let after: string;
  let written: string;
  if (tool === 'fs_write') {
    if (!isStr(ti['text'])) return bad('fs_write event has no tool_input.text; not checking this write.');
    after = written = ti['text'];
  } else {
    if (!isStr(ti['oldStr']) || !isStr(ti['newStr'])) return bad('str_replace event has no oldStr/newStr; not checking this write.');
    const { oldStr, newStr } = ti as { oldStr: string; newStr: string };
    if (oldStr === '' || !disk.includes(oldStr)) return ok;
    after = ti['replace_all'] === true ? disk.split(oldStr).join(newStr) : disk.replace(oldStr, () => newStr);
    written = newStr;
  }

  const added = addedLineNumbers(disk, after);
  if (added.size === 0) return ok;
  if (!deps.graveyard) return bad('no graveyard at .deja-boo/graveyard.json; not checking. Create it with: deja-boo index . --out .deja-boo/graveyard.json');

  const acked = acknowledgedIds(written);
  const hits = findRevenants(deps.graveyard, after.split('\n'), deps.config.thresholds, disk === '' ? [] : disk.split('\n'))
    .filter(h => !acked.has(h.tombstone.id));
  if (hits.length === 0) return ok;
  return { exitCode: 2, stderr: formatHookMessage(hits) };
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Entry point for `deja-boo hook`: PreToolUse JSON on stdin, message on stderr, exit code via process.exitCode. */
export function runHookCommand(): void {
  let raw: string;
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    process.stderr.write('deja-boo: cannot read the hook event from stdin; not checking this write.\n');
    process.exitCode = 1;
    return;
  }
  let cwd = process.cwd();
  try {
    const c = (JSON.parse(raw) as { cwd?: unknown }).cwd;
    if (typeof c === 'string') cwd = c;
  } catch { /* decideHook reports the invalid JSON */ }
  const r = decideHook(raw, { readFile: readOrUndefined, graveyard: loadGraveyard(cwd), config: loadConfig(cwd).config });
  process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;
}
