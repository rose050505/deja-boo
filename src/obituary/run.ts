import { entryFromGitHub, pickPullRequest, pullCandidatesFromGitHub } from '../core/obituary.js';
import type { Graveyard, Link, Obituary, ObituaryFile, ObituaryRef } from '../core/types.js';
import type { FetchOutcome, GitHubFetcher } from './github.js';
import type { GitHubRepo } from './remote.js';
import { selectCommits, type CommitToLookUp } from './select.js';

/** Most linked issues looked up per death commit. */
export const MAX_ISSUES_PER_COMMIT = 3;

export interface RunSummary {
  /** Commits looked up in this run that got a new entry. */
  lookedUp: number;
  withPr: number;
  withIssues: number;
  /** Looked up, no PR and no issue found. */
  neither: number;
  failed: number;
  /** Candidate commits not looked up because of `--limit` or a rate limit. */
  notReached: number;
  /** Present when GitHub stopped the run. */
  rateLimited?: { resetAt?: string; done: number; of: number };
}

export interface RunInput {
  graveyard: Pick<Graveyard, 'tombstones'>;
  repo: GitHubRepo;
  limit: number;
  existing: ObituaryFile;
  fetcher: GitHubFetcher;
  now: () => Date;
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

type Stop = { kind: 'rate-limited'; resetAt?: string };

/**
 * Look up the selected death commits on GitHub and return the obituary file (existing entries kept) and a summary.
 * Per commit: one `commits/{sha}/pulls` call, then at most 3 `issues/{n}` calls (never the chosen PR, never a number already fetched in this run).
 * Invariant: calls <= limit + 3 x limit; a rate limit stops all further calls and keeps exactly the entries completed before it; a failed commit gets no entry; existing entries are never refetched or changed.
 */
export async function runObituary(input: RunInput): Promise<{ file: ObituaryFile; summary: RunSummary }> {
  const { graveyard, repo, limit, existing, fetcher, now } = input;
  const candidates = selectCommits(graveyard, existing);
  const chosen = candidates.slice(0, limit);
  const file: ObituaryFile = { ...existing };
  const summary: RunSummary = { lookedUp: 0, withPr: 0, withIssues: 0, neither: 0, failed: 0, notReached: 0 };
  const base = `/repos/${repo.owner}/${repo.name}`;
  const issueMemo = new Map<number, ObituaryRef | 'error'>();
  let processed = 0;

  async function lookUp(c: CommitToLookUp): Promise<Obituary | 'failed' | Stop> {
    const pulls: FetchOutcome = await fetcher(`${base}/commits/${c.sha}/pulls`);
    if (pulls.kind === 'rate-limited') return pulls.resetAt === undefined ? { kind: 'rate-limited' } : { kind: 'rate-limited', resetAt: pulls.resetAt };
    if (pulls.kind === 'error') return 'failed';
    const candidatesPr = pullCandidatesFromGitHub(pulls.json);
    if (candidatesPr === null) return 'failed';
    const pr = pickPullRequest(candidatesPr, c.sha)?.ref ?? null;

    const issues: ObituaryRef[] = [];
    const numbers = linkedNumbers(c.links, repo).filter(n => n !== pr?.number).slice(0, MAX_ISSUES_PER_COMMIT);
    for (const n of numbers) {
      let got = issueMemo.get(n);
      if (got === undefined) {
        const out = await fetcher(`${base}/issues/${n}`);
        if (out.kind === 'rate-limited') return out.resetAt === undefined ? { kind: 'rate-limited' } : { kind: 'rate-limited', resetAt: out.resetAt };
        const ref = out.kind === 'ok' ? entryFromGitHub(out.json) : null;
        got = ref ?? 'error';
        issueMemo.set(n, got);
      }
      if (got === 'error') return 'failed';
      issues.push(got);
    }
    return { pr, issues, fetchedAt: now().toISOString() };
  }

  for (const c of chosen) {
    const result = await lookUp(c);
    if (typeof result === 'object' && 'kind' in result) {
      summary.rateLimited = result.resetAt === undefined ? { done: processed, of: chosen.length } : { resetAt: result.resetAt, done: processed, of: chosen.length };
      break;
    }
    processed++;
    if (result === 'failed') {
      summary.failed++;
      continue;
    }
    file[c.sha] = result;
    summary.lookedUp++;
    if (result.pr !== null) summary.withPr++;
    if (result.issues.length > 0) summary.withIssues++;
    if (result.pr === null && result.issues.length === 0) summary.neither++;
  }
  summary.notReached = candidates.length - processed;
  return { file: sortedFile(file), summary };
}

/** The file with keys in sha order. Invariant: same entries, sorted keys. */
export function sortedFile(file: ObituaryFile): ObituaryFile {
  return Object.fromEntries(Object.keys(file).sort().map(k => [k, file[k] as Obituary]));
}
