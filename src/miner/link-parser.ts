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
 * Deduplicates by (type, ref); preserves first-appearance order.
 */
export function parseLinks(message: string): Link[] {
  const links: Link[] = [];
  // key = `${type}:${ref}` for dedup
  const seen = new Set<string>();

  function add(type: 'issue' | 'pr', ref: string, url?: string): void {
    const key = `${type}:${ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      const link: Link = { type, ref };
      if (url !== undefined) link.url = url;
      links.push(link);
    }
  }

  // 1. Full GitHub PR URLs (must run before issue URLs to avoid false issue matches)
  for (const m of message.matchAll(GH_PR_URL)) {
    add('pr', m[1] as string, m[0]);
  }

  // 2. Full GitHub issue URLs
  for (const m of message.matchAll(GH_ISSUE_URL)) {
    add('issue', m[1] as string, m[0]);
  }

  // 3. Close-keyword refs (e.g. "fixes #42")
  for (const m of message.matchAll(CLOSE_KW)) {
    add('issue', m[1] as string);
  }

  // 4. Bare refs (e.g. "#123") — only those not already seen as a URL ref
  for (const m of message.matchAll(BARE_REF)) {
    // A bare #N could be an issue or a PR; we cannot tell from context, treat as issue.
    add('issue', m[1] as string);
  }

  return links;
}
