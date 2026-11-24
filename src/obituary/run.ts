import { entryFromGitHub, hasObituaryText, pickPullRequest, pullCandidatesFromGitHub } from '../core/obituary.js';
import { isRevertSubject } from '../core/revert.js';
import type { Graveyard, Link, Obituary, ObituaryFile, ObituaryRef } from '../core/types.js';
import type { FetchOutcome, GitHubFetcher } from './github.js';
import type { GitHubRepo } from './remote.js';
import { selectCommits, type CommitToLookUp } from './select.js';

/** Most linked issues looked up per death commit. */
export const MAX_ISSUES_PER_COMMIT = 3;

export interface RunSummary {
  /** Commits looked up in this run that got a new or updated entry. */
  lookedUp: number;
  withPr: number;
  withIssues: number;
  /** Looked up, no PR and no issue found. */
  neither: number;
  /** Commits that got no entry because a request failed. */
  failed: number;
  /** Commits whose entry was saved but has linked issues that could not be fetched (retried on the next run). */
  partial: number;
  /** Candidate commits not looked up because of `--limit` or a stop. */
  notReached: number;
  /** Present when GitHub stopped the run with a rate limit. `secondary` is a 403 without rate-limit headers. */
  rateLimited?: { resetAt?: string; secondary?: boolean; done: number; of: number };
  /** Present when the run stopped on a cause that every further request would share (bad token, missing repository, no network). */
  fatal?: { cause: string; done: number; of: number };
}

export interface RunInput {
  graveyard: Pick<Graveyard, 'tombstones'>;
  repo: GitHubRepo;
  limit: number;
  existing: ObituaryFile;
  fetcher: GitHubFetcher;
  now: () => Date;
  /** Called after each commit with (commits done, commits selected). */
  onProgress?: (done: number, of: number) => void;
}

/** Linked issue or PR numbers of one commit that belong to `repo`, in link order, without repeats. */
function linkedNumbers(links: Link[], repo: GitHubRepo): number[] {
  const prefix = `https://github.com/${repo.owner}/${repo.name}/`.toLowerCase();
  const out: number[] = [];
  for (const l of links) {
    if (l.url !== undefined && !l.url.toLowerCase().startsWith(prefix)) continue;
    const n = Number(l.ref);
    if (Number.isInteger(n) && n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

type Stop = { kind: 'stop'; rate?: { resetAt?: string; secondary?: boolean }; fatal?: string };

const stopRate = (out: Extract<FetchOutcome, { kind: 'rate-limited' }>): Stop => ({
  kind: 'stop',
  rate: { ...(out.resetAt === undefined ? {} : { resetAt: out.resetAt }), ...(out.secondary === true ? { secondary: true } : {}) },
});

/**
 * Look up the selected death commits on GitHub and return the obituary file (existing entries kept) and a summary.
 * Per commit: one `commits/{sha}/pulls` call, then at most 3 `issues/{n}` calls (never the chosen PR, never a number already fetched in this run). A commit whose entry has `failedIssues` costs only those issue calls.
 * Stops at the first rate limit (also a 403 without rate-limit headers), 401, 404 for the repository itself, or network error, with the cause in the summary.
 * Invariant: calls <= limit + 3 x limit (+ 1 repository check); a stop keeps exactly the entries completed before it and makes no further calls; a failed pull request lookup leaves no entry; a failed issue lookup keeps the pull request and is recorded in `failedIssues`; complete existing entries are never refetched or changed.
 */
export async function runObituary(input: RunInput): Promise<{ file: ObituaryFile; summary: RunSummary }> {
  const { graveyard, repo, limit, existing, fetcher, now } = input;
  const candidates = selectCommits(graveyard, existing);
  const chosen = candidates.slice(0, limit);
  const file: ObituaryFile = { ...existing };
  const summary: RunSummary = { lookedUp: 0, withPr: 0, withIssues: 0, neither: 0, failed: 0, partial: 0, notReached: 0 };
  const base = `/repos/${repo.owner}/${repo.name}`;
  const issueMemo = new Map<number, ObituaryRef | 'error'>();
  let processed = 0;
  let repoMissing: Promise<boolean> | undefined;

  /** The stop for a request outcome that cannot be fixed per commit, or null. */
  async function stopFor(out: FetchOutcome, checkRepoOn404: boolean): Promise<Stop | null> {
    if (out.kind === 'ok') return null;
    if (out.kind === 'rate-limited') return stopRate(out);
    if (out.network === true) return { kind: 'stop', fatal: `cannot reach GitHub (${out.message}). Check the network connection.` };
    if (out.status === 401) return { kind: 'stop', fatal: 'GitHub rejected the credentials (HTTP 401). Check GITHUB_TOKEN or run `gh auth login`.' };
    if (out.status === 404 && checkRepoOn404) {
      repoMissing ??= fetcher(base).then(r => r.kind === 'error' && (r.status === 404 || r.status === 401));
      if (await repoMissing) return { kind: 'stop', fatal: `repository ${repo.owner}/${repo.name} not found (HTTP 404). Check the name; a private repository needs a token that can read it.` };
    }
    return null;
  }

  async function lookUp(c: CommitToLookUp): Promise<Obituary | 'failed' | Stop> {
    let pr: ObituaryRef | null;
    let numbers: number[];
    const kept: ObituaryRef[] = [];
    if (c.previous !== undefined) {
      pr = c.previous.pr;
      kept.push(...c.previous.issues);
      numbers = (c.previous.failedIssues ?? []).slice(0, MAX_ISSUES_PER_COMMIT);
    } else {
      const pulls = await fetcher(`${base}/commits/${c.sha}/pulls`);
      const stop = await stopFor(pulls, true);
      if (stop !== null) return stop;
      if (pulls.kind !== 'ok') return 'failed';
      const candidatesPr = pullCandidatesFromGitHub(pulls.json);
      if (candidatesPr === null) return 'failed';
      pr = pickPullRequest(candidatesPr, c.sha)?.ref ?? null;
      numbers = linkedNumbers(c.links, repo).filter(n => n !== pr?.number).slice(0, MAX_ISSUES_PER_COMMIT);
    }

    const issues: ObituaryRef[] = [...kept];
    const failedIssues: number[] = [];
    for (const n of numbers) {
      let got = issueMemo.get(n);
      if (got === undefined) {
        const out = await fetcher(`${base}/issues/${n}`);
        const stop = await stopFor(out, false);
        if (stop !== null) return stop;
        got = (out.kind === 'ok' ? entryFromGitHub(out.json) : null) ?? 'error';
        issueMemo.set(n, got);
      }
      if (got === 'error') failedIssues.push(n);
      else issues.push(got);
    }
    const order = linkedNumbers(c.links, repo);
    const rank = (n: number): number => (order.includes(n) ? order.indexOf(n) : order.length + n);
    issues.sort((a, b) => rank(a.number) - rank(b.number));
    const entry: Obituary = { pr, issues, fetchedAt: now().toISOString() };
    return failedIssues.length > 0 ? { ...entry, failedIssues } : entry;
  }

  for (const c of chosen) {
    const result = await lookUp(c);
    if (typeof result === 'object' && 'kind' in result) {
      const where = { done: processed, of: chosen.length };
      if (result.fatal !== undefined) summary.fatal = { cause: result.fatal, ...where };
      else summary.rateLimited = { ...result.rate, ...where };
      break;
    }
    processed++;
    input.onProgress?.(processed, chosen.length);
    if (result === 'failed') {
      summary.failed++;
      continue;
    }
    file[c.sha] = result;
    summary.lookedUp++;
    if (result.failedIssues !== undefined) summary.partial++;
    if (result.pr !== null) summary.withPr++;
    if (result.issues.length > 0) summary.withIssues++;
    if (result.pr === null && result.issues.length === 0) summary.neither++;
  }
  summary.notReached = candidates.length - processed;
  return { file: sortedFile(file), summary };
}

/** Tombstones whose death commit has obituary text, out of all tombstones, and the same for Reverts. Invariant: with <= total; both counts only grow when an entry gains text. */
export function coverage(graveyard: Pick<Graveyard, 'tombstones'>, file: ObituaryFile): { withText: number; total: number; revertsWithText: number; reverts: number } {
  const r = { withText: 0, total: graveyard.tombstones.length, revertsWithText: 0, reverts: 0 };
  for (const t of graveyard.tombstones) {
    const has = hasObituaryText(file[t.commit]);
    const revert = isRevertSubject(t.causeOfDeath);
    if (has) r.withText++;
    if (revert) r.reverts++;
    if (revert && has) r.revertsWithText++;
  }
  return r;
}

/** The file with keys in sha order. Invariant: same entries, sorted keys. */
export function sortedFile(file: ObituaryFile): ObituaryFile {
  return Object.fromEntries(Object.keys(file).sort().map(k => [k, file[k] as Obituary]));
}
