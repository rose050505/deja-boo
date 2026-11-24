import { execFile } from 'node:child_process';

/** A GitHub repository. */
export interface GitHubRepo {
  owner: string;
  name: string;
}

const PART = /^[A-Za-z0-9_.-]+$/;

function repoFrom(path: string): GitHubRepo | null {
  const parts = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 2) return null;
  const owner = parts[0] as string;
  const name = (parts[1] as string).replace(/\.git$/, '');
  if (!PART.test(owner) || !PART.test(name) || name === '' || name === '.' || name === '..') return null;
  return { owner, name };
}

/**
 * Parse a git remote URL (`https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, `ssh://git@github.com/o/r(.git)`) into owner and name; null for other hosts and junk.
 * Invariant: never returns a value for a host other than github.com; credentials in the URL are dropped, never returned.
 */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  const text = url.trim();
  const scp = /^[A-Za-z0-9_.-]+@github\.com:(.+)$/.exec(text);
  if (scp !== null) return repoFrom(scp[1] as string);
  if (!/^(?:https|ssh):\/\//i.test(text)) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') return null;
  return repoFrom(parsed.pathname);
}

/** `https://github.com/<owner>/<name>`. Invariant: no `.git`, no trailing slash. */
export function repoUrlOf(repo: GitHubRepo): string {
  return `https://github.com/${repo.owner}/${repo.name}`;
}

/** Parse `owner/name` (the `--repo` flag); null when it is not exactly that. */
export function parseRepoSlug(slug: string): GitHubRepo | null {
  if (slug.includes(':') || slug.startsWith('/')) return null;
  return repoFrom(slug.trim());
}

/** The GitHub repo of `git remote get-url origin` in `cwd`; null when there is no origin, git fails, or the host is not github.com. */
export function originRepo(cwd: string): Promise<GitHubRepo | null> {
  return new Promise(resolve => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : parseGitHubRemote(String(stdout)));
    });
  });
}
