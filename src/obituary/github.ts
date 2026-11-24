import { execFileSync } from 'node:child_process';

/** Result of one GitHub API request. */
export type FetchOutcome =
  | { kind: 'ok'; json: unknown }
  | { kind: 'rate-limited'; resetAt?: string }
  | { kind: 'error'; status?: number; message: string };

/** Performs one GET against the GitHub API; `path` looks like `/repos/o/r/issues/12`. Never throws. */
export type GitHubFetcher = (path: string) => Promise<FetchOutcome>;

const API_ORIGIN = 'https://api.github.com';

/** ISO time of the reset announced by the response headers, if any. */
function resetAtOf(headers: Headers, nowMs: number): string | undefined {
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset) && reset > 0) return new Date(reset * 1000).toISOString();
  const retry = Number(headers.get('retry-after'));
  if (headers.get('retry-after') !== null && Number.isFinite(retry) && retry >= 0) return new Date(nowMs + retry * 1000).toISOString();
  return undefined;
}

/**
 * The only code that calls `fetch`. Sends the token only to https://api.github.com; maps rate limits (429, or 403 with `x-ratelimit-remaining: 0` or `retry-after`) to `rate-limited`, every other failure to `error`.
 * Invariant: never throws; the token never appears in a returned message.
 */
export function createGitHubFetcher(token?: string): GitHubFetcher {
  const scrub = (text: string): string => (token !== undefined && token !== '' ? text.split(token).join('***') : text);
  return async path => {
    if (!path.startsWith('/')) return { kind: 'error', message: 'invalid path' };
    const url = new URL(path, API_ORIGIN);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'deja-boo',
    };
    if (token !== undefined && token !== '' && url.origin === API_ORIGIN) headers['Authorization'] = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      return { kind: 'error', message: scrub(`network error: ${e instanceof Error ? e.message : String(e)}`) };
    }
    const limited =
      res.status === 429 ||
      (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after') !== null));
    if (limited) {
      const resetAt = resetAtOf(res.headers, Date.now());
      return resetAt === undefined ? { kind: 'rate-limited' } : { kind: 'rate-limited', resetAt };
    }
    if (!res.ok) return { kind: 'error', status: res.status, message: scrub(`HTTP ${res.status} for ${url.pathname}`) };
    try {
      return { kind: 'ok', json: (await res.json()) as unknown };
    } catch {
      return { kind: 'error', status: res.status, message: scrub(`invalid JSON for ${url.pathname}`) };
    }
  };
}

/** Runs `gh auth token`; the token on stdout, or null when gh is missing or fails. */
export function ghAuthToken(): string | null {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * Pick the token: `GITHUB_TOKEN` if non-empty, else the output of `runGh()`, else none.
 * Invariant: `runGh` is not called when GITHUB_TOKEN is set; the result is trimmed and never empty.
 */
export function resolveToken(env: Record<string, string | undefined>, runGh: () => string | null): string | undefined {
  const fromEnv = env['GITHUB_TOKEN']?.trim();
  if (fromEnv) return fromEnv;
  const fromGh = runGh()?.trim();
  return fromGh ? fromGh : undefined;
}
