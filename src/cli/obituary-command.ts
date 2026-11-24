import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseObituaryFile } from '../core/obituary.js';
import type { Graveyard, ObituaryFile } from '../core/types.js';
import { createGitHubFetcher, ghAuthToken, resolveToken, type GitHubFetcher } from '../obituary/github.js';
import { originRepo, parseRepoSlug, type GitHubRepo } from '../obituary/remote.js';
import { coverage, runObituary, sortedFile, type RunSummary } from '../obituary/run.js';
import { GRAVEYARD_FILE } from '../watch/load.js';

export const OBITUARY_FILE = '.deja-boo/obituaries.json';
export const DEFAULT_LIMIT = 300;

export interface CommandResult { exitCode: 0 | 1 | 3; stdout: string; stderr: string }

/** Everything the command takes from the outside, so tests never touch the network, `gh`, or the clock. */
export interface ObituaryDeps {
  env: Record<string, string | undefined>;
  runGh: () => string | null;
  createFetcher: (token?: string) => GitHubFetcher;
  originRepo: (cwd: string) => Promise<GitHubRepo | null>;
  now: () => Date;
  /** Progress sink (stderr in real use); omitted in tests that do not look at it. */
  progress?: (text: string) => void;
}

export const realDeps: ObituaryDeps = {
  env: process.env,
  runGh: ghAuthToken,
  createFetcher: createGitHubFetcher,
  originRepo,
  now: () => new Date(),
  progress: text => { process.stderr.write(text); },
};

function deepSorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepSorted);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, deepSorted(o[k])]));
  }
  return v;
}

/** The obituary file as text: sorted keys at every level. Invariant: parses back to the same entries. */
export function obituaryJson(file: ObituaryFile): string {
  return JSON.stringify(deepSorted(sortedFile(file)), null, 2) + '\n';
}

function summaryText(repo: GitHubRepo, s: RunSummary, requests: number, out: string, cov: ReturnType<typeof coverage>): string {
  const row = (label: string, n: number | string): string => `  ${label.padEnd(14)}${n}\n`;
  return (
    `Obituaries for ${repo.owner}/${repo.name}\n` +
    row('looked up', s.lookedUp) + row('with a PR', s.withPr) + row('with issues', s.withIssues) + row('neither found', s.neither) +
    row('failed', s.failed) + row('issues failed', s.partial) + row('not reached', s.notReached) + row('requests', requests) + row('written to', out) +
    `tombstones with text ${cov.withText}/${cov.total}, Reverts ${cov.revertsWithText}/${cov.reverts}\n`
  );
}

const fail = (exitCode: 1 | 3, message: string): CommandResult => ({ exitCode, stdout: '', stderr: `deja-boo: ${message}\n` });

/**
 * `deja-boo obituary [--repo owner/name] [--limit N] [--graveyard <file>] [--out <file>]`: ask GitHub about the death commits and write the obituary file.
 * Invariant: exit 1 for bad arguments, no GitHub repo or an invalid existing output file (nothing written); 3 for a missing graveyard; 1 also when no lookup succeeded and some failed or the run stopped on a bad token, a missing repository or no network (the cause is on stderr); 0 otherwise, including after a rate limit, which writes the entries gathered so far.
 */
export async function runObituaryCommand(argv: string[], cwd: string, deps: ObituaryDeps = realDeps): Promise<CommandResult> {
  let values: { repo?: string; limit?: string; graveyard?: string; out?: string };
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      options: { repo: { type: 'string' }, limit: { type: 'string' }, graveyard: { type: 'string' }, out: { type: 'string' } },
    }).values;
  } catch (err) {
    return fail(1, `${err instanceof Error ? err.message : String(err)}. Usage: deja-boo obituary [--repo owner/name] [--limit N] [--graveyard <file>] [--out <file>]`);
  }

  let limit = DEFAULT_LIMIT;
  if (values.limit !== undefined) {
    if (!/^\d+$/.test(values.limit) || Number(values.limit) < 1 || !Number.isSafeInteger(Number(values.limit))) return fail(1, '--limit must be an integer >= 1');
    limit = Number(values.limit);
  }

  let repo: GitHubRepo | null;
  if (values.repo !== undefined) {
    repo = parseRepoSlug(values.repo);
    if (repo === null) return fail(1, `--repo must look like owner/name, got "${values.repo}"`);
  } else {
    repo = await deps.originRepo(cwd);
    if (repo === null) return fail(1, 'cannot tell the GitHub repository (no github.com origin remote). Pass --repo owner/name.');
  }

  const graveyardPath = resolve(cwd, values.graveyard ?? GRAVEYARD_FILE);
  let graveyard: Graveyard;
  try {
    const parsed = JSON.parse(readFileSync(graveyardPath, 'utf8')) as Graveyard;
    if (!Array.isArray(parsed.tombstones)) throw new Error('not a graveyard');
    graveyard = parsed;
  } catch {
    return fail(3, `no readable graveyard at ${graveyardPath}. Create it by running \`deja-boo index . --out ${GRAVEYARD_FILE}\`.`);
  }

  const outPath = resolve(cwd, values.out ?? OBITUARY_FILE);
  let existing: ObituaryFile = {};
  if (existsSync(outPath)) {
    let parsed: ObituaryFile | null = null;
    try {
      parsed = parseObituaryFile(JSON.parse(readFileSync(outPath, 'utf8')));
    } catch {
      parsed = null;
    }
    if (parsed === null) return fail(1, `${outPath} exists but is not a valid obituary file. Delete it to start over.`);
    existing = parsed;
  }

  const token = resolveToken(deps.env, deps.runGh);
  const auth = token === undefined ? 'no token (60 requests per hour; set GITHUB_TOKEN or run `gh auth login`)' : deps.env['GITHUB_TOKEN']?.trim() ? 'GITHUB_TOKEN' : '`gh auth token`';
  const fetcher = deps.createFetcher(token);
  let requests = 0;
  const counted: GitHubFetcher = path => {
    requests++;
    return fetcher(path);
  };

  const { file, summary } = await runObituary({
    graveyard, repo, limit, existing, fetcher: counted, now: deps.now,
    onProgress: (done, of) => deps.progress?.(`deja-boo: ${done}/${of}\n`),
  });
  const changed = summary.lookedUp > 0 || existsSync(outPath);
  if (changed) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, obituaryJson(file));
  }

  let stderr = `deja-boo: GitHub auth: ${auth}\n`;
  if (summary.rateLimited !== undefined) {
    const r = summary.rateLimited;
    const what = r.secondary === true ? 'GitHub refused the request with HTTP 403 and no rate-limit headers (a secondary rate limit)' : 'GitHub rate limit reached';
    stderr += `deja-boo: ${what} after ${r.done} of ${r.of} commits; ${r.resetAt !== undefined ? `it resets at ${r.resetAt}` : 'the reset time is unknown, wait a few minutes'}. The entries so far are saved; run the command again later to continue.\n`;
  }
  if (summary.fatal !== undefined) {
    stderr += `deja-boo: stopped after ${summary.fatal.done} of ${summary.fatal.of} commits: ${summary.fatal.cause}\n`;
  }
  const everyRequestFailed = summary.lookedUp === 0 && (summary.failed > 0 || summary.fatal !== undefined);
  if (everyRequestFailed && summary.fatal === undefined) stderr += `deja-boo: every lookup failed (${summary.failed} commits); no entry was written.\n`;
  return { exitCode: everyRequestFailed ? 1 : 0, stdout: summaryText(repo, summary, requests, outPath, coverage(graveyard, file)), stderr };
}

/** Entry point for `deja-boo obituary`. */
export async function obituaryMain(argv: string[]): Promise<void> {
  const r = await runObituaryCommand(argv, process.cwd());
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;
}
