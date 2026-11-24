import type { Obituary, ObituaryRef } from './types.js';

/** Longest excerpt stored, in UTF-16 code units. */
export const EXCERPT_MAX = 400;

const ELLIPSIS = '\u2026';

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** Cut `text` to at most `max` code units without leaving half a surrogate pair at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end);
}

/**
 * Collapse whitespace and take the first 400 code units without splitting a surrogate pair.
 * Invariant: `excerpt` is a prefix of the whitespace-collapsed body with length <= 400, and `truncated` is true iff the collapsed body is longer.
 */
export function makeExcerpt(body: string | null | undefined): { excerpt: string; truncated: boolean } {
  const collapsed = (body ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = cut(collapsed, EXCERPT_MAX);
  return { excerpt, truncated: collapsed.length > excerpt.length };
}

/** True when the obituary has a pull request or an issue with a non-empty excerpt. Invariant: false for undefined and for entries with only titles. */
export function hasObituaryText(o: Obituary | undefined): boolean {
  if (o === undefined) return false;
  return (o.pr !== null && o.pr.excerpt !== '') || o.issues.some(i => i.excerpt !== '');
}

/** The reference shown for an obituary: the pull request, else the first issue, each only with text. */
export function primaryRef(o: Obituary): { kind: 'PR' | 'issue'; ref: ObituaryRef } | null {
  if (o.pr !== null && o.pr.excerpt !== '') return { kind: 'PR', ref: o.pr };
  const issue = o.issues.find(i => i.excerpt !== '');
  return issue === undefined ? null : { kind: 'issue', ref: issue };
}

/**
 * One line `Obituary (PR #5353, <url>): "<excerpt>"`; '' when there is no text. The label and URL are fixed text; the quoted excerpt is untrusted third-party text, verbatim.
 * A truncated or shortened excerpt ends with an ellipsis inside the quotes. Invariant: length <= max (when max >= 0), and '' iff `hasObituaryText` is false.
 */
export function obituaryLine(o: Obituary, max: number): string {
  const p = primaryRef(o);
  if (p === null) return '';
  const head = `Obituary (${p.kind} #${p.ref.number}, ${p.ref.url}): "`;
  const tail = '"';
  const room = max - head.length - tail.length;
  let text = p.ref.excerpt;
  let ellipsis = p.ref.truncated;
  if (text.length + (ellipsis ? 1 : 0) > room) {
    text = cut(text, Math.max(0, room - 1));
    ellipsis = true;
  }
  const line = head + text + (ellipsis ? ELLIPSIS : '') + tail;
  return line.length <= max ? line : cut(line, Math.max(0, max));
}

/** The fields of a GitHub pull request that decide which one explains a commit. */
export interface PullCandidate {
  ref: ObituaryRef;
  merged: boolean;
  mergeCommitSha: string | null;
}

/**
 * Choose the pull request for a death commit: the merged one whose merge commit is the death commit, else the merged one with the lowest number, else the lowest number.
 * Invariant: deterministic and independent of the order of `candidates`; undefined only for an empty list.
 */
export function pickPullRequest(candidates: readonly PullCandidate[], sha: string): PullCandidate | undefined {
  const byNumber = (a: PullCandidate, b: PullCandidate): number => a.ref.number - b.ref.number;
  const sorted = [...candidates].sort(byNumber);
  return (
    sorted.find(c => c.merged && c.mergeCommitSha === sha) ??
    sorted.find(c => c.merged) ??
    sorted[0]
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate the JSON of one GitHub pull request or issue and build its reference; null on a bad shape.
 * Requires an integer `number`, string `html_url` and `title`; `body` may be a string or null. Invariant: never invents a field.
 */
export function entryFromGitHub(json: unknown): ObituaryRef | null {
  if (!isRecord(json)) return null;
  const { number, html_url, title, body } = json;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null;
  if (typeof html_url !== 'string' || html_url === '' || typeof title !== 'string') return null;
  if (body !== null && body !== undefined && typeof body !== 'string') return null;
  const { excerpt, truncated } = makeExcerpt(body);
  return { number, url: html_url, title, excerpt, truncated };
}

/**
 * Validate the JSON of `GET /commits/{sha}/pulls` into candidates; null when it is not an array of pull request objects.
 * Invariant: null as soon as one element has a bad shape.
 */
export function pullCandidatesFromGitHub(json: unknown): PullCandidate[] | null {
  if (!Array.isArray(json)) return null;
  const out: PullCandidate[] = [];
  for (const item of json) {
    const ref = entryFromGitHub(item);
    if (ref === null || !isRecord(item)) return null;
    const mergedAt = item['merged_at'];
    const mergeSha = item['merge_commit_sha'];
    if (mergedAt !== null && mergedAt !== undefined && typeof mergedAt !== 'string') return null;
    if (mergeSha !== null && mergeSha !== undefined && typeof mergeSha !== 'string') return null;
    out.push({ ref, merged: typeof mergedAt === 'string', mergeCommitSha: typeof mergeSha === 'string' ? mergeSha : null });
  }
  return out;
}

function refOrNull(v: unknown): ObituaryRef | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const { number, url, title, excerpt, truncated } = v;
  if (typeof number !== 'number' || !Number.isInteger(number) || typeof url !== 'string' || typeof title !== 'string') return undefined;
  if (typeof excerpt !== 'string' || typeof truncated !== 'boolean') return undefined;
  return { number, url, title, excerpt, truncated };
}

/**
 * Validate the parsed JSON of an obituary file; null when any key is not a 40-character hex sha or any entry has a bad shape.
 * Invariant: a returned file has only valid entries (nothing is repaired or dropped silently).
 */
export function parseObituaryFile(json: unknown): Record<string, Obituary> | null {
  if (!isRecord(json)) return null;
  const out: Record<string, Obituary> = {};
  for (const [sha, entry] of Object.entries(json)) {
    if (!/^[0-9a-f]{40}$/.test(sha) || !isRecord(entry)) return null;
    const pr = refOrNull(entry['pr']);
    const rawIssues = entry['issues'];
    const fetchedAt = entry['fetchedAt'];
    if (pr === undefined || !Array.isArray(rawIssues) || typeof fetchedAt !== 'string') return null;
    const issues: ObituaryRef[] = [];
    for (const i of rawIssues) {
      const r = refOrNull(i);
      if (r === undefined || r === null) return null;
      issues.push(r);
    }
    out[sha] = { pr, issues, fetchedAt };
  }
  return out;
}
