import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIndex } from '../miner/index.js';
import { toGraveyardJson } from '../miner/serialize.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { Graveyard, Tombstone } from '../core/types.js';
import type { GitHubFetcher } from '../obituary/github.js';
import { decideHook } from './hook-command.js';
import { decideStop, gitStopDeps } from './stop-command.js';
import { runObituaryCommand, type ObituaryDeps } from './obituary-command.js';
import { loadConfig, loadGraveyard } from '../watch/load.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const BUILDER = join(root, 'src/test-fixtures/haunted-http.sh');
const MAIN = join(root, 'dist/cli/main.js');
const PULLS = join(root, 'src/test-fixtures/github-pulls-24bcb9e.json');
const REQUESTS_OBITUARY = join(root, 'src/test-fixtures/requests-obituary-24bcb9e.json');
const REQUESTS_CLONE = join(root, '../probe/repos/requests');
const SUBJECT = "Use the pool's native chunked mode for uploads";
const PR_URL = 'https://github.com/psf/requests/pull/5353';
const REAL_TEXT = 'A number of PRs were merged back in September without any proper review.';

/** Rebuild dist only when the CLI entry is older than a source file. */
function ensureDist(): void {
  const newest = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'src', 'tsconfig.build.json'], { cwd: root })
    .toString().split('\0').filter(f => f.endsWith('.ts') || f.endsWith('.json'))
    .reduce((m, f) => Math.max(m, existsSync(join(root, f)) ? statSync(join(root, f)).mtimeMs : 0), 0);
  if (!existsSync(MAIN) || statSync(MAIN).mtimeMs < newest) {
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.build.json'], { cwd: root });
  }
}

/**
 * A fetcher that replays the recorded GitHub answer for PR #5353 for any commit's pull list.
 * The fixture commit message says "Fixes #42", so issue 42 is answered with a synthetic empty-bodied issue (not recorded; it adds no text). Anything else is a 404.
 */
const recorded: GitHubFetcher = async path => {
  if (/\/commits\/[0-9a-f]{40}\/pulls(\?.*)?$/.test(path)) return { kind: 'ok', json: JSON.parse(readFileSync(PULLS, 'utf8')) as unknown };
  if (path.endsWith('/issues/42')) return { kind: 'ok', json: { number: 42, html_url: 'https://github.com/psf/requests/issues/42', title: 'fixture issue', body: null } };
  return { kind: 'error', status: 404, message: 'not recorded' };
};

const deps: ObituaryDeps = {
  env: {}, runGh: () => null, createFetcher: () => recorded,
  originRepo: async () => ({ owner: 'psf', name: 'requests' }), now: () => new Date('2026-11-24T09:44:37.373Z'),
};

describe('demo acceptance: obituary on the fixture (recorded PR #5353 response)', () => {
  let dir: string;
  let repo: string;
  let revert: Tombstone;
  let event: string;
  const run = () => decideHook(event, {
    readFile: p => (existsSync(p) ? readFileSync(p, 'utf8') : undefined),
    graveyard: loadGraveyard(repo),
    config: loadConfig(repo).config,
  });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-obit-demo-'));
    repo = join(dir, 'repo');
    execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' });
    const g: Graveyard = await runIndex(repo, { ...DEFAULT_MINER_CONFIG, graceDays: 0 });
    mkdirSync(join(repo, '.deja-boo'), { recursive: true });
    writeFileSync(join(repo, '.deja-boo/graveyard.json'), toGraveyardJson(g));
    revert = g.tombstones.find(t => /^revert/i.test(t.causeOfDeath))!;
    const log = execFileSync('git', ['log', '--format=%H %s'], { cwd: repo }).toString().split('\n');
    const commit = log.find(l => l.slice(41) === SUBJECT)!.slice(0, 40);
    const native = execFileSync('git', ['show', `${commit}:haunted_http/adapter.py`], { cwd: repo }).toString().replace(/\braw\b/g, 'response');
    event = JSON.stringify({ hook_event_name: 'preToolUse', cwd: repo, session_id: 's', tool_name: 'fs_write', tool_input: { path: 'haunted_http/adapter.py', text: native } });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('hook stderr has the verbatim cause, the obituary line with URL and the block level; removing the file restores the old message', async () => {
    const before = run();
    expect(before.exitCode).toBe(2);
    expect(before.stderr).not.toContain('Obituary');

    const r = await runObituaryCommand(['--repo', 'psf/requests'], repo, deps);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(repo, '.deja-boo/obituaries.json'))).toBe(true);

    const after = run();
    expect(after.exitCode).toBe(2);
    expect(after.stderr).toContain('[block]');
    expect(after.stderr).toContain(`— ${revert.causeOfDeath}`);
    const body = (JSON.parse(readFileSync(PULLS, 'utf8')) as { body: string }[])[0]!.body.replace(/\s+/g, ' ').trim();
    expect(body.startsWith(REAL_TEXT)).toBe(true);
    expect(after.stderr.split('\n')).toContain(`Obituary (PR #5353, ${PR_URL}): "${body}"`);

    rmSync(join(repo, '.deja-boo/obituaries.json'));
    expect(run()).toEqual(before);
  });
});

/** The take-3 rewrite of HTTPAdapter.send() (docs/kiro-runs/video-takes/take3_noguard.txt): one urlopen call with chunked=chunked, HTTPResponse import dropped. */
function take3Rewrite(src: string): string {
  const a = src.indexOf('            if not chunked:\n                resp = conn.urlopen(');
  const b = src.indexOf('        except (ProtocolError, OSError) as err:');
  if (a < 0 || b < a) throw new Error('adapters.py does not look like requests at 26bea1e4^');
  const call = [
    '            resp = conn.urlopen(', '                method=request.method,', '                url=url,', '                body=request.body,',
    '                headers=request.headers,', '                redirect=False,', '                assert_same_host=False,', '                preload_content=False,',
    '                decode_content=False,', '                retries=self.max_retries,', '                timeout=timeout,', '                chunked=chunked,', '            )', '',
  ].join('\n');
  return (src.slice(0, a) + call + src.slice(b)).replace('from urllib3.response import HTTPResponse\n', '');
}

describe.skipIf(!existsSync(join(REQUESTS_CLONE, '.git')))('demo acceptance: the real requests scene (26bea1e4^ plus the PR #5353 obituary)', () => {
  let dir: string;
  let work: string;

  beforeAll(() => {
    ensureDist();
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-requests-scene-'));
    work = join(dir, 'requests');
    const scene = execFileSync('git', ['rev-parse', '26bea1e4^'], { cwd: REQUESTS_CLONE }).toString().trim();
    execFileSync('git', ['clone', '--quiet', '--no-checkout', REQUESTS_CLONE, work]);
    execFileSync('git', ['checkout', '--quiet', scene], { cwd: work });
    mkdirSync(join(work, '.deja-boo'), { recursive: true });
    execFileSync(process.execPath, [MAIN, 'index', work, '--out', join(work, '.deja-boo/graveyard.json')], { stdio: 'ignore' });
  }, 300_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('Stop blocks the take-3 rewrite; the reason carries the obituary (PR #5353) only when the file exists', () => {
    const adapters = join(work, 'requests/adapters.py');
    writeFileSync(adapters, take3Rewrite(readFileSync(adapters, 'utf8')));

    const plain = JSON.parse(decideStop('no-obit', gitStopDeps(work)).stdout) as { decision: string; reason: string };
    expect(plain.decision).toBe('block');
    expect(plain.reason).toContain('24bcb9e');
    expect(plain.reason).not.toContain('Obituary');

    copyFileSync(REQUESTS_OBITUARY, join(work, '.deja-boo/obituaries.json'));
    const out = JSON.parse(decideStop('with-obit', gitStopDeps(work)).stdout) as { decision: string; reason: string };
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('Obituary (PR #5353');
    expect(out.reason).toContain(`Obituary (PR #5353, ${PR_URL}): "${REAL_TEXT}`);
  }, 120_000);
});
