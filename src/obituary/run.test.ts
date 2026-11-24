import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Link, ObituaryFile, Tombstone } from '../core/types.js';
import type { FetchOutcome, GitHubFetcher } from './github.js';
import { runObituary } from './run.js';
import { selectCommits } from './select.js';
import { parseObituaryFile } from '../core/obituary.js';

const repo = { owner: 'o', name: 'r' };
const sha = (n: number): string => n.toString(16).padStart(40, '0');
const NOW = new Date('2026-01-02T03:04:05.000Z');
const now = (): Date => NOW;

function stone(id: string, commit: string, over: Partial<Tombstone> = {}): Tombstone {
  return { id, fingerprint: [], lines: [], path: 'a.ts', language: 'typescript', buriedAt: '', buriedAtTimestamp: 100, commit, author: 'a', causeOfDeath: 'remove it', links: [], revivals: [], deaths: [], aliveAtHead: false, ...over };
}
const revival = { commit: 'x', date: '', author: '', subject: '', similarity: 0.9, isRevert: false, isMergeArtifact: false };
const bare = (...refs: number[]): Link[] => refs.map(n => ({ type: 'ref' as const, ref: String(n) }));

const pr = (number: number, body: string | null, extra: Record<string, unknown> = {}) => ({
  number, html_url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, body, merged_at: '2020-01-01T00:00:00Z', merge_commit_sha: null, ...extra,
});
const issue = (number: number, body: string | null) => ({ number, html_url: `https://github.com/o/r/issues/${number}`, title: `Issue ${number}`, body });

/** A fetcher answering from a table, with a call log. Unknown paths answer 404. */
function scripted(table: Record<string, FetchOutcome | unknown>): { fetcher: GitHubFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: GitHubFetcher = async path => {
    calls.push(path);
    const v = table[path];
    if (v === undefined) return { kind: 'error', status: 404, message: 'HTTP 404' };
    if (typeof v === 'object' && v !== null && 'kind' in v) return v as FetchOutcome;
    return { kind: 'ok', json: v };
  };
  return { fetcher, calls };
}
const pulls = (s: string): string => `/repos/o/r/commits/${s}/pulls`;
const run = (tombstones: Tombstone[], fetcher: GitHubFetcher, over: { limit?: number; existing?: ObituaryFile } = {}) =>
  runObituary({ graveyard: { tombstones }, repo, limit: over.limit ?? 300, existing: over.existing ?? {}, fetcher, now });

describe('selection order', () => {
  it('Reverts, then revived, then linked; newest first; unreasoned and alive non-Reverts are skipped', () => {
    const ts = [
      stone('a', sha(1), { links: bare(1), buriedAtTimestamp: 500 }),
      stone('b', sha(2), { revivals: [revival], buriedAtTimestamp: 100 }),
      stone('c', sha(3), { causeOfDeath: 'Revert "x"', buriedAtTimestamp: 50 }),
      stone('d', sha(4), { causeOfDeath: 'Revert "y"', buriedAtTimestamp: 60 }),
      stone('e', sha(5), { buriedAtTimestamp: 900 }),
      stone('f', sha(6), { links: bare(2), aliveAtHead: true, buriedAtTimestamp: 900 }),
      stone('g', sha(7), { revivals: [revival], buriedAtTimestamp: 300 }),
      stone('h', sha(8), { causeOfDeath: 'Revert z', aliveAtHead: true, buriedAtTimestamp: 10 }),
    ];
    expect(selectCommits({ tombstones: ts }, {}).map(c => c.sha)).toEqual([sha(4), sha(3), sha(8), sha(7), sha(2), sha(1)]);
  });
  it('ties go by id and a shared death commit appears once', () => {
    const ts = [stone('z', sha(1), { links: bare(1) }), stone('y', sha(2), { links: bare(1) }), stone('x', sha(1), { links: bare(1) })];
    expect(selectCommits({ tombstones: ts }, {}).map(c => c.sha)).toEqual([sha(1), sha(2)]);
  });
});

describe('runObituary', () => {
  it('stores the PR with a verbatim excerpt and fetches a shared death commit once', async () => {
    const { fetcher, calls } = scripted({ [pulls(sha(1))]: [pr(5353, 'A number of PRs were merged\r\n\r\nback in September')] });
    const ts = [stone('a', sha(1), { causeOfDeath: 'Revert "x"' }), stone('b', sha(1), { causeOfDeath: 'Revert "x"' })];
    const { file, summary } = await run(ts, fetcher);
    expect(calls).toEqual([pulls(sha(1))]);
    expect(file[sha(1)]).toEqual({
      pr: { number: 5353, url: 'https://github.com/o/r/pull/5353', title: 'PR 5353', excerpt: 'A number of PRs were merged back in September', truncated: false },
      issues: [],
      fetchedAt: NOW.toISOString(),
    });
    expect(summary).toMatchObject({ lookedUp: 1, withPr: 1, withIssues: 0, neither: 0, failed: 0, notReached: 0 });
  });

  it('looks up at most 3 linked issues, never the chosen PR, and memoizes them across commits', async () => {
    const { fetcher, calls } = scripted({
      [pulls(sha(1))]: [pr(2, 'why')],
      [pulls(sha(2))]: [],
      '/repos/o/r/issues/1': issue(1, 'one'),
      '/repos/o/r/issues/3': issue(3, 'three'),
      '/repos/o/r/issues/4': issue(4, 'four'),
      '/repos/o/r/issues/5': issue(5, 'five'),
    });
    const ts = [
      stone('a', sha(1), { causeOfDeath: 'Revert a', buriedAtTimestamp: 2, links: bare(1, 2, 3, 4, 5) }),
      stone('b', sha(2), { causeOfDeath: 'Revert b', buriedAtTimestamp: 1, links: bare(3, 4) }),
    ];
    const { file } = await run(ts, fetcher);
    expect(calls).toEqual([pulls(sha(1)), '/repos/o/r/issues/1', '/repos/o/r/issues/3', '/repos/o/r/issues/4', pulls(sha(2)), ]);
    expect(file[sha(1)]?.issues.map(i => i.number)).toEqual([1, 3, 4]);
    expect(file[sha(2)]?.issues.map(i => i.number)).toEqual([3, 4]);
  });

  it('ignores links that point at another repository', async () => {
    const { fetcher, calls } = scripted({ [pulls(sha(1))]: [] });
    const links: Link[] = [{ type: 'issue', ref: '9', url: 'https://github.com/other/repo/issues/9' }];
    const { file } = await run([stone('a', sha(1), { links })], fetcher);
    expect(calls).toEqual([pulls(sha(1))]);
    expect(file[sha(1)]).toMatchObject({ pr: null, issues: [] });
  });

  it('a linked issue that answers 404 is recorded in failedIssues; no entry is lost', async () => {
    const { fetcher } = scripted({ [pulls(sha(1))]: [] });
    const { file, summary } = await run([stone('a', sha(1), { links: bare(1) })], fetcher);
    expect(file[sha(1)]).toEqual({ pr: null, issues: [], fetchedAt: NOW.toISOString(), failedIssues: [1] });
    expect(summary).toMatchObject({ failed: 0, partial: 1, lookedUp: 1 });
  });

  it('stores a pr: null entry for a commit without a PR, and counts it as neither', async () => {
    const second = scripted({ [pulls(sha(2))]: [] });
    const r = await run([stone('b', sha(2), { causeOfDeath: 'Revert b' })], second.fetcher);
    expect(r.file[sha(2)]).toEqual({ pr: null, issues: [], fetchedAt: NOW.toISOString() });
    expect(r.summary).toMatchObject({ lookedUp: 1, neither: 1 });
  });

  it('keeps existing entries, does not refetch them, and they do not count toward the limit', async () => {
    const old = { pr: null, issues: [], fetchedAt: '2020-01-01T00:00:00.000Z' };
    const { fetcher, calls } = scripted({ [pulls(sha(2))]: [pr(7, 'x')], [pulls(sha(3))]: [pr(8, 'y')] });
    const ts = [stone('a', sha(1), { causeOfDeath: 'Revert 1', buriedAtTimestamp: 3 }), stone('b', sha(2), { causeOfDeath: 'Revert 2', buriedAtTimestamp: 2 }), stone('c', sha(3), { causeOfDeath: 'Revert 3', buriedAtTimestamp: 1 })];
    const { file, summary } = await run(ts, fetcher, { limit: 1, existing: { [sha(1)]: old } });
    expect(calls).toEqual([pulls(sha(2))]);
    expect(file[sha(1)]).toEqual(old);
    expect(Object.keys(file)).toEqual([sha(1), sha(2)]);
    expect(summary.notReached).toBe(1);
  });

  it('an error leaves no entry and the run continues', async () => {
    const { fetcher } = scripted({ [pulls(sha(1))]: { kind: 'error', status: 500, message: 'HTTP 500' }, [pulls(sha(2))]: [pr(3, 'ok')], [pulls(sha(3))]: { not: 'a list' } });
    const ts = [stone('a', sha(1), { causeOfDeath: 'Revert 1', buriedAtTimestamp: 3 }), stone('b', sha(2), { causeOfDeath: 'Revert 2', buriedAtTimestamp: 2 }), stone('c', sha(3), { causeOfDeath: 'Revert 3', buriedAtTimestamp: 1 })];
    const { file, summary } = await run(ts, fetcher);
    expect(Object.keys(file)).toEqual([sha(2)]);
    expect(summary).toMatchObject({ lookedUp: 1, failed: 2 });
  });

  it('a rate limit at call k keeps exactly the earlier entries and makes no further calls', async () => {
    const calls: string[] = [];
    const fetcher: GitHubFetcher = async path => {
      calls.push(path);
      return calls.length === 3 ? { kind: 'rate-limited', resetAt: '2026-01-02T04:00:00.000Z' } : { kind: 'ok', json: [pr(calls.length, 'x')] };
    };
    const ts = [1, 2, 3, 4].map(n => stone(String(n), sha(n), { causeOfDeath: `Revert ${n}`, buriedAtTimestamp: 10 - n }));
    const { file, summary } = await run(ts, fetcher);
    expect(calls).toHaveLength(3);
    expect(Object.keys(file)).toEqual([sha(1), sha(2)]);
    expect(summary.rateLimited).toEqual({ resetAt: '2026-01-02T04:00:00.000Z', done: 2, of: 4 });
    expect(summary.notReached).toBe(2);
  });
});

// ─── Properties ──────────────────────────────────────────────────────────────

const graveyardArb = fc.array(
  fc.record({
    commit: fc.integer({ min: 1, max: 12 }),
    revert: fc.boolean(),
    refs: fc.array(fc.integer({ min: 1, max: 6 }), { maxLength: 6 }),
    ts: fc.integer({ min: 0, max: 50 }),
  }),
  { maxLength: 14 },
).map(rows => rows.map((r, i) => stone(`id${i}`, sha(r.commit), { causeOfDeath: r.revert ? 'Revert x' : 'remove', links: bare(...r.refs), buriedAtTimestamp: r.ts })));

const bodyArb = fc.oneof(fc.string({ maxLength: 700 }), fc.constant(null));

/** A deterministic world: commit n has a PR (number 100 + n) for even n; issue k has a body from `bodies`. */
function world(bodies: (string | null)[], rateLimitAt?: number) {
  const calls: string[] = [];
  const bodiesSeen = new Map<string, string | null>();
  const fetcher: GitHubFetcher = async path => {
    calls.push(path);
    if (rateLimitAt !== undefined && calls.length === rateLimitAt) return { kind: 'rate-limited' };
    const m = /\/commits\/(\w+)\/pulls$/.exec(path);
    if (m) {
      const n = parseInt(m[1] as string, 16);
      if (n % 2 === 1) return { kind: 'ok', json: [] };
      const body = bodies[n % bodies.length] ?? null;
      bodiesSeen.set(`pr${100 + n}`, body);
      return { kind: 'ok', json: [pr(100 + n, body)] };
    }
    const k = Number(/\/issues\/(\d+)$/.exec(path)?.[1]);
    const body = bodies[k % bodies.length] ?? null;
    bodiesSeen.set(`issue${k}`, body);
    return { kind: 'ok', json: issue(k, body) };
  };
  return { fetcher, calls, bodiesSeen };
}
const collapse = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

describe('runObituary properties', () => {
  const bodiesArb = fc.array(bodyArb, { minLength: 1, maxLength: 4 });

  it('fetch budget: calls <= limit + 3 x commits processed, and no issue number repeats', async () => {
    await fc.assert(fc.asyncProperty(graveyardArb, fc.integer({ min: 1, max: 8 }), bodiesArb, async (ts, limit, bodies) => {
      const w = world(bodies);
      const { summary } = await run(ts, w.fetcher, { limit });
      const processed = summary.lookedUp + summary.failed;
      expect(processed).toBeLessThanOrEqual(limit);
      expect(w.calls.length).toBeLessThanOrEqual(limit + 3 * processed);
      const issueCalls = w.calls.filter(c => c.includes('/issues/'));
      expect(new Set(issueCalls).size).toBe(issueCalls.length);
      const pullCalls = w.calls.filter(c => c.includes('/pulls'));
      expect(pullCalls.length).toBe(processed);
    }), { numRuns: 60 });
  });

  it('verbatim: every excerpt is a prefix of the collapsed body the fetcher returned', async () => {
    await fc.assert(fc.asyncProperty(graveyardArb, bodiesArb, async (ts, bodies) => {
      const w = world(bodies);
      const { file } = await run(ts, w.fetcher);
      for (const e of Object.values(file)) {
        for (const [key, r] of [...(e.pr ? [[`pr${e.pr.number}`, e.pr] as const] : []), ...e.issues.map(i => [`issue${i.number}`, i] as const)]) {
          const c = collapse(w.bodiesSeen.get(key) ?? null);
          expect(c.startsWith(r.excerpt)).toBe(true);
          expect(r.truncated).toBe(c.length > r.excerpt.length);
          expect(r.excerpt.length).toBeLessThanOrEqual(400);
        }
      }
    }), { numRuns: 60 });
  });

  it('a rate limit at call k yields a valid partial file, then a full re-run fetches only the missing commits', async () => {
    await fc.assert(fc.asyncProperty(graveyardArb, fc.integer({ min: 1, max: 20 }), bodiesArb, async (ts, k, bodies) => {
      const limited = world(bodies, k);
      const first = await run(ts, limited.fetcher);
      expect(limited.calls.length).toBeLessThanOrEqual(k);
      if (first.summary.rateLimited !== undefined) expect(limited.calls.length).toBe(k);
      const reparsed = parseObituaryFile(JSON.parse(JSON.stringify(first.file)));
      expect(reparsed).toEqual(first.file);
      const all = selectCommits({ tombstones: ts }, {}).map(c => c.sha);
      const missing = all.filter(s => first.file[s] === undefined);
      const full = world(bodies);
      const second = await run(ts, full.fetcher, { existing: first.file });
      const refetched = full.calls.filter(c => c.includes('/pulls')).map(c => /commits\/(\w+)\/pulls/.exec(c)?.[1]);
      expect(refetched).toEqual(missing);
      for (const [s, e] of Object.entries(first.file)) expect(second.file[s]).toEqual(e);
      expect(Object.keys(second.file).sort()).toEqual([...all].sort());
    }), { numRuns: 60 });
  });
});
