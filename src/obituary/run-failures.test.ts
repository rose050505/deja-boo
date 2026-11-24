import { describe, it, expect } from 'vitest';
import type { Link, ObituaryFile, Tombstone } from '../core/types.js';
import type { FetchOutcome, GitHubFetcher } from './github.js';
import { coverage, runObituary } from './run.js';
import { selectCommits } from './select.js';

const repo = { owner: 'o', name: 'r' };
const sha = (n: number): string => n.toString(16).padStart(40, '0');
const NOW = new Date('2026-01-02T03:04:05.000Z');
const stone = (id: string, commit: string, over: Partial<Tombstone> = {}): Tombstone => ({
  id, fingerprint: [], lines: [], path: 'a.ts', language: 'typescript', buriedAt: '', buriedAtTimestamp: 100, commit, author: 'a',
  causeOfDeath: 'Revert x', links: [], revivals: [], deaths: [], aliveAtHead: false, ...over,
});
const bare = (...refs: number[]): Link[] => refs.map(n => ({ type: 'ref' as const, ref: String(n) }));
const pr = (number: number, body: string | null) => ({ number, html_url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, body, merged_at: '2020-01-01T00:00:00Z', merge_commit_sha: null });
const issue = (number: number, body: string | null) => ({ number, html_url: `https://github.com/o/r/issues/${number}`, title: `Issue ${number}`, body });
const pulls = (s: string): string => `/repos/o/r/commits/${s}/pulls`;
const ok = (json: unknown): FetchOutcome => ({ kind: 'ok', json });
const err = (status: number): FetchOutcome => ({ kind: 'error', status, message: `HTTP ${status}` });

function scripted(table: Record<string, FetchOutcome>, fallback: FetchOutcome = err(404)) {
  const calls: string[] = [];
  const fetcher: GitHubFetcher = async path => {
    calls.push(path);
    return table[path] ?? fallback;
  };
  return { fetcher, calls };
}
const run = (tombstones: Tombstone[], fetcher: GitHubFetcher, existing: ObituaryFile = {}, onProgress?: (d: number, o: number) => void) =>
  runObituary({ graveyard: { tombstones }, repo, limit: 300, existing, fetcher, now: () => NOW, ...(onProgress ? { onProgress } : {}) });
const many = (n: number): Tombstone[] => Array.from({ length: n }, (_, i) => stone(`t${i}`, sha(i + 1), { buriedAtTimestamp: 1000 - i }));

describe('failures stop the run with a cause', () => {
  it.each([
    ['a bad token (401)', err(401), /credentials.*401/],
    ['a network error', { kind: 'error', network: true, message: 'network error: ENOTFOUND' } as FetchOutcome, /cannot reach GitHub.*ENOTFOUND/],
  ])('%s stops at the first request', async (_n, outcome, cause) => {
    const { fetcher, calls } = scripted({}, outcome);
    const { file, summary } = await run(many(10), fetcher);
    expect(calls).toHaveLength(1);
    expect(file).toEqual({});
    expect(summary.fatal?.cause).toMatch(cause);
    expect(summary).toMatchObject({ lookedUp: 0, failed: 0, notReached: 10 });
  });

  it('a 404 for the repository itself stops; a 404 for one commit does not', async () => {
    const gone = scripted({}, err(404));
    const a = await run(many(10), gone.fetcher);
    expect(gone.calls).toEqual([pulls(sha(1)), '/repos/o/r']);
    expect(a.summary.fatal?.cause).toMatch(/o\/r not found/);

    const fine = scripted({ '/repos/o/r': ok({}), [pulls(sha(1))]: err(404), [pulls(sha(2))]: ok([pr(5, 'why')]) });
    const b = await run(many(2), fine.fetcher);
    expect(b.summary).toMatchObject({ failed: 1, lookedUp: 1 });
    expect(b.summary.fatal).toBeUndefined();
    expect(fine.calls.filter(c => c === '/repos/o/r')).toHaveLength(1);
  });

  it('a 403 without rate-limit headers stops as a secondary rate limit and keeps earlier entries', async () => {
    const { fetcher, calls } = scripted({ [pulls(sha(1))]: ok([pr(5, 'why')]), [pulls(sha(2))]: { kind: 'rate-limited', secondary: true } });
    const { file, summary } = await run(many(5), fetcher);
    expect(calls).toEqual([pulls(sha(1)), pulls(sha(2))]);
    expect(Object.keys(file)).toEqual([sha(1)]);
    expect(summary.rateLimited).toMatchObject({ secondary: true, done: 1, of: 5 });
  });

  it('a 401 while fetching an issue also stops', async () => {
    const { fetcher, calls } = scripted({ [pulls(sha(1))]: ok([]), '/repos/o/r/issues/9': err(401) });
    const { file, summary } = await run([stone('a', sha(1), { links: bare(9) }), stone('b', sha(2))], fetcher);
    expect(calls).toEqual([pulls(sha(1)), '/repos/o/r/issues/9']);
    expect(file).toEqual({});
    expect(summary.fatal).toBeDefined();
  });
});

describe('a failed issue lookup keeps the PR', () => {
  const t = [stone('a', sha(1), { links: bare(7, 8) })];
  it('records failedIssues beside the found PR and issue', async () => {
    const { fetcher } = scripted({ [pulls(sha(1))]: ok([pr(2539, 'because')]), '/repos/o/r/issues/7': err(500), '/repos/o/r/issues/8': ok(issue(8, 'eight')) });
    const { file, summary } = await run(t, fetcher);
    expect(file[sha(1)]?.pr).toMatchObject({ number: 2539, excerpt: 'because' });
    expect(file[sha(1)]?.issues.map(i => i.number)).toEqual([8]);
    expect(file[sha(1)]?.failedIssues).toEqual([7]);
    expect(summary).toMatchObject({ lookedUp: 1, partial: 1, failed: 0 });
  });
  it('a re-run asks only for the failed issues and then drops failedIssues', async () => {
    const first = scripted({ [pulls(sha(1))]: ok([pr(2539, 'because')]), '/repos/o/r/issues/7': err(500), '/repos/o/r/issues/8': ok(issue(8, 'eight')) });
    const { file } = await run(t, first.fetcher);
    expect(selectCommits({ tombstones: t }, file).map(c => c.sha)).toEqual([sha(1)]);
    const second = scripted({ '/repos/o/r/issues/7': ok(issue(7, 'seven')) });
    const again = await run(t, second.fetcher, file);
    expect(second.calls).toEqual(['/repos/o/r/issues/7']);
    expect(again.file[sha(1)]?.pr?.number).toBe(2539);
    expect(again.file[sha(1)]?.issues.map(i => i.number)).toEqual([7, 8]);
    expect(again.file[sha(1)]).not.toHaveProperty('failedIssues');
    expect(selectCommits({ tombstones: t }, again.file)).toEqual([]);
  });
});

describe('progress and coverage', () => {
  it('reports N/M after each commit', async () => {
    const seen: string[] = [];
    const { fetcher } = scripted({}, ok([]));
    await run(many(3), fetcher, {}, (d, o) => seen.push(`${d}/${o}`));
    expect(seen).toEqual(['1/3', '2/3', '3/3']);
  });
  it('coverage counts tombstones with text and Reverts with text', () => {
    const ts = [stone('a', sha(1)), stone('b', sha(2), { causeOfDeath: 'drop it' }), stone('c', sha(3), { causeOfDeath: 'drop it' })];
    const text = { pr: { number: 1, url: 'https://github.com/o/r/pull/1', title: 't', excerpt: 'why', truncated: false }, issues: [], fetchedAt: 'x' };
    expect(coverage({ tombstones: ts }, { [sha(1)]: text, [sha(2)]: text, [sha(3)]: { pr: null, issues: [], fetchedAt: 'x' } }))
      .toEqual({ withText: 2, total: 3, revertsWithText: 1, reverts: 1 });
  });
});
