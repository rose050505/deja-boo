import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchOutcome, GitHubFetcher } from '../obituary/github.js';
import type { Graveyard, Tombstone } from '../core/types.js';
import { runObituaryCommand, type ObituaryDeps } from './obituary-command.js';

const sha = (n: number): string => n.toString(16).padStart(40, '0');
const stone = (n: number): Tombstone => ({
  id: `id${n}`, fingerprint: [], lines: [], path: 'a.ts', language: 'typescript', buriedAt: '', buriedAtTimestamp: 100 - n, commit: sha(n), author: 'a',
  causeOfDeath: `Revert ${n}`, links: [], revivals: [], deaths: [], aliveAtHead: false,
});
const pr = (number: number) => ({ number, html_url: `https://github.com/o/r/pull/${number}`, title: 't', body: 'because', merged_at: '2020-01-01T00:00:00Z', merge_commit_sha: null });

let dir: string;
let paths: string[];
let tokensSeen: Array<string | undefined>;

function deps(answer: (path: string, call: number) => FetchOutcome, over: Partial<ObituaryDeps> = {}): ObituaryDeps {
  let call = 0;
  return {
    env: {},
    runGh: () => null,
    createFetcher: token => {
      tokensSeen.push(token);
      const f: GitHubFetcher = async path => {
        paths.push(path);
        return answer(path, ++call);
      };
      return f;
    },
    originRepo: async () => ({ owner: 'o', name: 'r' }),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    ...over,
  };
}
const okPulls = (_: string, call: number): FetchOutcome => ({ kind: 'ok', json: [pr(call)] });

function writeGraveyard(n: number, file = '.deja-boo/graveyard.json'): void {
  const g: Graveyard = { tombstones: Array.from({ length: n }, (_, i) => stone(i + 1)), stats: { commits: 1, tombstones: n, revivals: 0, revivalsViaRevert: 0, mergeArtifactRevivals: 0, aliveAtHead: 0, aliveAtHeadReverts: 0, medianRevivalGapDays: null } };
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), JSON.stringify(g));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deja-boo-obit-'));
  paths = [];
  tokensSeen = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('deja-boo obituary', () => {
  it('defaults: reads .deja-boo/graveyard.json, writes .deja-boo/obituaries.json with sorted keys, prints the summary', async () => {
    writeGraveyard(3);
    const r = await runObituaryCommand([], dir, deps(okPulls));
    expect(r.exitCode).toBe(0);
    const out = join(dir, '.deja-boo/obituaries.json');
    const text = readFileSync(out, 'utf8');
    const file = JSON.parse(text) as Record<string, Record<string, unknown>>;
    expect(Object.keys(file)).toEqual([sha(1), sha(2), sha(3)]);
    expect(Object.keys(file[sha(1)] as object)).toEqual(['fetchedAt', 'issues', 'pr']);
    expect(Object.keys((file[sha(1)] as { pr: object }).pr)).toEqual(['excerpt', 'number', 'title', 'truncated', 'url']);
    expect(text.endsWith('\n')).toBe(true);
    expect(r.stdout).toMatch(/looked up\s+3/);
    expect(r.stdout).toMatch(/with a PR\s+3/);
    expect(r.stdout).toMatch(/requests\s+3/);
    expect(paths[0]).toBe(`/repos/o/r/commits/${sha(1)}/pulls`);
    expect(r.stderr).toContain('no token');
  });

  it('--limit, --repo, --graveyard and --out are honoured; a re-run keeps entries and fetches only the rest', async () => {
    writeGraveyard(3, 'g/gy.json');
    const args = ['--repo', 'x/y', '--limit', '2', '--graveyard', 'g/gy.json', '--out', 'o/out.json'];
    const first = await runObituaryCommand(args, dir, deps(okPulls));
    expect(first.exitCode).toBe(0);
    expect(paths).toEqual([`/repos/x/y/commits/${sha(1)}/pulls`, `/repos/x/y/commits/${sha(2)}/pulls`]);
    expect(first.stdout).toMatch(/not reached\s+1/);
    paths = [];
    const second = await runObituaryCommand(args, dir, deps(okPulls));
    expect(paths).toEqual([`/repos/x/y/commits/${sha(3)}/pulls`]);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'o/out.json'), 'utf8')) as object)).toEqual([sha(1), sha(2), sha(3)]);
    expect(second.exitCode).toBe(0);
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc'], ['']])('rejects --limit %j with exit 1 and writes nothing', async limit => {
    writeGraveyard(1);
    const r = await runObituaryCommand(['--limit', limit], dir, deps(okPulls));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--limit');
    expect(existsSync(join(dir, '.deja-boo/obituaries.json'))).toBe(false);
    expect(paths).toEqual([]);
  });

  it('exit 1 with one line when no GitHub repo can be determined, or --repo is malformed', async () => {
    writeGraveyard(1);
    const none = await runObituaryCommand([], dir, deps(okPulls, { originRepo: async () => null }));
    expect(none.exitCode).toBe(1);
    expect(none.stderr.trim().split('\n')).toHaveLength(1);
    expect((await runObituaryCommand(['--repo', 'not a repo'], dir, deps(okPulls))).exitCode).toBe(1);
    expect((await runObituaryCommand(['--bogus'], dir, deps(okPulls))).exitCode).toBe(1);
    expect(existsSync(join(dir, '.deja-boo/obituaries.json'))).toBe(false);
  });

  it('exit 3 with how to create the graveyard when it is missing or unreadable', async () => {
    const r = await runObituaryCommand([], dir, deps(okPulls));
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('deja-boo index . --out .deja-boo/graveyard.json');
    mkdirSync(join(dir, '.deja-boo'), { recursive: true });
    writeFileSync(join(dir, '.deja-boo/graveyard.json'), '{not json');
    expect((await runObituaryCommand([], dir, deps(okPulls))).exitCode).toBe(3);
  });

  it('a rate limit writes the entries so far, says so on stderr, and exits 0', async () => {
    writeGraveyard(4);
    const r = await runObituaryCommand([], dir, deps((p, call) => (call === 3 ? { kind: 'rate-limited', resetAt: '2026-01-02T04:00:00.000Z' } : { kind: 'ok', json: [pr(call)] })));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('after 2 of 4 commits');
    expect(r.stderr).toContain('2026-01-02T04:00:00.000Z');
    expect(Object.keys(JSON.parse(readFileSync(join(dir, '.deja-boo/obituaries.json'), 'utf8')) as object)).toEqual([sha(1), sha(2)]);
    expect(paths).toHaveLength(3);
  });

  it('refuses to overwrite an invalid existing output file', async () => {
    writeGraveyard(1);
    writeFileSync(join(dir, '.deja-boo/obituaries.json'), '{"short":{}}');
    const r = await runObituaryCommand([], dir, deps(okPulls));
    expect(r.exitCode).toBe(1);
    expect(readFileSync(join(dir, '.deja-boo/obituaries.json'), 'utf8')).toBe('{"short":{}}');
  });

  it('uses GITHUB_TOKEN, then gh, and never prints the token', async () => {
    writeGraveyard(1);
    const secret = 'ghp_TOPSECRET';
    const a = await runObituaryCommand([], dir, deps(okPulls, { env: { GITHUB_TOKEN: secret }, runGh: () => 'other' }));
    expect(tokensSeen).toEqual([secret]);
    expect(a.stderr).toContain('GITHUB_TOKEN');
    rmSync(join(dir, '.deja-boo/obituaries.json'));
    const b = await runObituaryCommand([], dir, deps(okPulls, { runGh: () => `${secret}\n` }));
    expect(tokensSeen).toEqual([secret, secret]);
    expect(b.stderr).toContain('gh auth token');
    for (const r of [a, b]) expect(r.stdout + r.stderr + readFileSync(join(dir, '.deja-boo/obituaries.json'), 'utf8')).not.toContain(secret);
  });
});

describe('deja-boo obituary: failures and progress', () => {
  it.each([
    ['a bad token', { kind: 'error', status: 401, message: 'HTTP 401' } as FetchOutcome, /credentials/],
    ['no network', { kind: 'error', network: true, message: 'network error: ENOTFOUND' } as FetchOutcome, /cannot reach GitHub/],
  ])('%s: prints the cause, stops after one request, exits 1, writes nothing', async (_n, outcome, cause) => {
    writeGraveyard(50);
    const r = await runObituaryCommand([], dir, deps(() => outcome));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(cause);
    expect(paths).toHaveLength(1);
    expect(existsSync(join(dir, '.deja-boo/obituaries.json'))).toBe(false);
  });

  it('a missing repository (404 for the commit and for the repo) stops and exits 1', async () => {
    writeGraveyard(50);
    const r = await runObituaryCommand([], dir, deps(() => ({ kind: 'error', status: 404, message: 'HTTP 404' })));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/o\/r not found/);
    expect(paths).toHaveLength(2);
  });

  it('a secondary rate limit stops with reset advice and exits 0 when entries were saved', async () => {
    writeGraveyard(5);
    const r = await runObituaryCommand([], dir, deps((_p, call) => (call === 2 ? { kind: 'rate-limited', secondary: true } : { kind: 'ok', json: [pr(call)] })));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/secondary rate limit.*wait a few minutes/);
    expect(paths).toHaveLength(2);
  });

  it('every lookup failing (500) exits 1', async () => {
    writeGraveyard(3);
    const r = await runObituaryCommand([], dir, deps(() => ({ kind: 'error', status: 500, message: 'HTTP 500' })));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/every lookup failed/);
  });

  it('streams N/M progress and prints the tombstone summary', async () => {
    writeGraveyard(3);
    const progress: string[] = [];
    const r = await runObituaryCommand([], dir, deps(okPulls, { progress: t => progress.push(t) }));
    expect(progress).toEqual(['deja-boo: 1/3\n', 'deja-boo: 2/3\n', 'deja-boo: 3/3\n']);
    expect(r.stdout).toContain('tombstones with text 3/3, Reverts 3/3');
  });
});
