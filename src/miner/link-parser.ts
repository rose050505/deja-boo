import type { Link } from '../core/types.js';

// GitHub close keywords (case-insensitive)
const CLOSE_KW = /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;
// Bare ref: #123 (not preceded by a slash, to avoid matching URL paths)
const BARE_REF = /(?<![/\w])#(\d+)/g;
// Full GitHub issue URL: https://github.com/<owner>/<repo>/issues/<n>
const GH_ISSUE_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/g;
// Full GitHub pull URL: https://github.com/<owner>/<repo>/pull/<n>
const GH_PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g;

/**
 * Parse issue and PR references from a commit message.
 * A full `/pull/N` URL is `pr`, a full `/issues/N` URL and a close-keyword reference are `issue`, a bare `#N` is `ref` (kind unknown).
 * With `repoUrl`, links without a URL get `<repoUrl>/issues/N` (GitHub redirects it to the pull request when N is one).
 * Invariant: never two links with the same `ref` (the most specific kind wins); a bare `#N` is `ref`; with `repoUrl` every link has a url, without it only URL-form links do; first-appearance order within each form.
 */
export function parseLinks(message: string, repoUrl?: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();

  function add(type: Link['type'], ref: string, url?: string): void {
    if (seen.has(ref)) return;
    seen.add(ref);
    const link: Link = { type, ref };
    const resolved = url ?? (repoUrl !== undefined ? `${repoUrl}/issues/${ref}` : undefined);
    if (resolved !== undefined) link.url = resolved;
    links.push(link);
  }

  // Most specific kind first, so a later, vaguer mention of the same number is dropped.
  // 1. Full GitHub PR URLs
  for (const m of message.matchAll(GH_PR_URL)) add('pr', m[1] as string, m[0]);
  // 2. Full GitHub issue URLs
  for (const m of message.matchAll(GH_ISSUE_URL)) add('issue', m[1] as string, m[0]);
  // 3. Close-keyword refs (e.g. "fixes #42")
  for (const m of message.matchAll(CLOSE_KW)) add('issue', m[1] as string);
  // 4. Bare refs (e.g. "#123"): an issue or a PR, which the text cannot tell.
  for (const m of message.matchAll(BARE_REF)) add('ref', m[1] as string);

  return links;
}
