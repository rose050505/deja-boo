import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIndex } from '../miner/index.js';
import { toGraveyardJson } from '../miner/serialize.js';
import { matchWindowed } from '../core/match.js';
import { hauntLevel } from '../core/level.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { Graveyard, Tombstone } from '../core/types.js';
import { decideHook } from './hook-command.js';
import { loadConfig, loadGraveyard } from '../watch/load.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const BUILDER = join(root, 'src/test-fixtures/haunted-http.sh');
const MAIN = join(root, 'dist/cli/main.js');
const SUBJECT = "Use the pool's native chunked mode for uploads";
const CAUSE = `Revert "${SUBJECT}"`;

/** Rebuild dist only when the CLI entry is older than a source file, so `npm test` stays self-contained. */
function ensureDist(): void {
  const newest = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'src', 'tsconfig.build.json'], { cwd: root })
    .toString().split('\0').filter(f => f.endsWith('.ts') || f.endsWith('.json'))
    .reduce((m, f) => Math.max(m, existsSync(join(root, f)) ? statSync(join(root, f)).mtimeMs : 0), 0);
  if (!existsSync(MAIN) || statSync(MAIN).mtimeMs < newest) {
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.build.json'], { cwd: root });
  }
}

describe('demo acceptance (REQ-9)', () => {
  let dir: string;
  let repo: string;
  let revert: Tombstone;
  let head: string;
  let native: string;
  let eventA: string;
  const ev = (tool_name: string, tool_input: unknown): string =>
    JSON.stringify({ hook_event_name: 'preToolUse', cwd: repo, session_id: 's', tool_name, tool_input });
  const run = (raw: string) => decideHook(raw, {
    readFile: p => (existsSync(p) ? readFileSync(p, 'utf8') : undefined),
    graveyard: loadGraveyard(repo),
    config: loadConfig(repo).config,
  });

  beforeAll(async () => {
    ensureDist();
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-demo-hook-'));
    repo = join(dir, 'repo');
    execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' });
    const g: Graveyard = await runIndex(repo, { ...DEFAULT_MINER_CONFIG, graceDays: 0 });
    mkdirSync(join(repo, '.deja-boo'), { recursive: true });
    writeFileSync(join(repo, '.deja-boo/graveyard.json'), toGraveyardJson(g));
    revert = g.tombstones.find(t => /^revert/i.test(t.causeOfDeath))!;
    head = readFileSync(join(repo, 'haunted_http/adapter.py'), 'utf8');
    const log = execFileSync('git', ['log', '--format=%H %s'], { cwd: repo }).toString().split('\n');
    const commit = log.find(l => l.slice(41) === SUBJECT)!.slice(0, 40);
    native = execFileSync('git', ['show', `${commit}:haunted_http/adapter.py`], { cwd: repo }).toString();
    eventA = ev('fs_write', { path: 'haunted_http/adapter.py', text: native.replace(/\braw\b/g, 'response') });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function expectEvidence(stderr: string): void {
    expect(stderr).toContain(revert.id);
    expect(stderr).toContain(revert.commit.slice(0, 7));
    expect(stderr).toContain(CAUSE);
    expect(stderr).toMatch(/lines \d+-\d+ of this write/);
  }

  it('event A: the renamed native adapter fires, and the write raised the score by at least 0.1', () => {
    const r = run(eventA);
    expect(r.exitCode).toBe(2);
    expectEvidence(r.stderr);
    const after = native.replace(/\braw\b/g, 'response').split('\n');
    const sAfter = matchWindowed(revert, after).similarity;
    const sBefore = matchWindowed(revert, head.split('\n')).similarity;
    expect(hauntLevel(revert, sAfter)).toBe('block');
    expect(sAfter).toBeGreaterThanOrEqual(sBefore + 0.1);
    const [from, to] = matchWindowed(revert, after).matchedLines;
    expect(r.stderr).toContain(`lines ${from}-${to} of this write`);
  });

  it('event B: the HEAD adapter written back unchanged is silent', () => {
    expect(run(ev('fs_write', { path: 'haunted_http/adapter.py', text: head }))).toEqual({ exitCode: 0, stderr: '' });
  });

  it('event C: str_replace of the manual if/else with the native call fires', () => {
    const start = head.indexOf('        if not chunked:');
    const end = head.indexOf('        return Response.from_raw');
    const oldStr = head.slice(start, end);
    expect(oldStr).toContain('        else:\n            # Stream the body ourselves');
    const nStart = native.indexOf('        raw = conn.urlopen(');
    const newStr = native.slice(nStart, native.indexOf('        return Response.from_raw'));
    const r = run(ev('str_replace', { path: 'haunted_http/adapter.py', oldStr, newStr }));
    expect(r.exitCode).toBe(2);
    expectEvidence(r.stderr);
  });

  it('event D: copying the surviving non-chunked call into a new method is silent', () => {
    const start = head.indexOf('        raw = conn.urlopen(');
    const call = head.slice(start, head.indexOf('        else:', start)).replace(/^ {4}/gm, '');
    const copy = `${head.trimEnd()}\n\n    def send_again(self, request, timeout=None):\n        conn = self.pool.connection_for(request.url)\n${call}\n        return Response.from_raw(raw, request)\n`;
    expect(run(ev('fs_write', { path: 'haunted_http/adapter.py', text: copy }))).toEqual({ exitCode: 0, stderr: '' });
  });

  it('event A through a spawned `node dist/cli/main.js hook`: exit 2 and stderr survive the process', () => {
    const p = spawnSync(process.execPath, [MAIN, 'hook'], { cwd: repo, input: eventA, encoding: 'utf8' });
    expect(p.status).toBe(2);
    expect(p.stdout).toBe('');
    expectEvidence(p.stderr);
  });
});
