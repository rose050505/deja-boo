import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

/** Run git in `cwd`; stdout, or undefined on any failure. */
export function git(cwd: string, args: string[]): string | undefined {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.error || r.status !== 0 ? undefined : r.stdout;
}

/** Text of `relPath` (relative to `cwd`) at HEAD, or undefined when it is not tracked there, `cwd` is not a git repo, or git fails. */
export function gitShowHead(cwd: string, relPath: string): string | undefined {
  return git(cwd, ['show', `HEAD:./${relPath}`]);
}

/**
 * HEAD's version of `path` (absolute, or relative to `cwd`) when the path lies inside `cwd`; undefined otherwise.
 * Invariant: a path outside `cwd` never reads from git.
 */
export function headVersionOf(cwd: string, path: string): string | undefined {
  const rel = relative(cwd, isAbsolute(path) ? path : resolve(cwd, path));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return gitShowHead(cwd, rel.split('\\').join('/'));
}
