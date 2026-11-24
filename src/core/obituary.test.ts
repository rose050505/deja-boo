import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { entryFromGitHub, hasObituaryText, makeExcerpt, obituaryLine, pickPullRequest, pullCandidatesFromGitHub, type PullCandidate } from './obituary.js';
import type { Obituary, ObituaryRef } from './types.js';

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
const ref = (over: Partial<ObituaryRef> = {}): ObituaryRef => ({ number: 5353, url: 'https://github.com/psf/requests/pull/5353', title: 't', excerpt: 'A reason', truncated: false, ...over });
const obit = (over: Partial<Obituary> = {}): Obituary => ({ pr: ref(), issues: [], fetchedAt: '2026-01-02T03:04:05.000Z', ...over });

describe('makeExcerpt', () => {
  it('handles empty and null bodies', () => {
    expect(makeExcerpt('')).toEqual({ excerpt: '', truncated: false });
    expect(makeExcerpt(null)).toEqual({ excerpt: '', truncated: false });
    expect(makeExcerpt(undefined)).toEqual({ excerpt: '', truncated: false });
    expect(makeExcerpt(' \n\t ')).toEqual({ excerpt: '', truncated: false });
  });
  it('collapses whitespace runs', () => {
    expect(makeExcerpt('  a \r\n\r\n  b\t\tc  ')).toEqual({ excerpt: 'a b c', truncated: false });
  });
  it('cuts long bodies at 400 and flags truncation', () => {
    const r = makeExcerpt('x'.repeat(401));
    expect(r.excerpt).toHaveLength(400);
    expect(r.truncated).toBe(true);
    expect(makeExcerpt('x'.repeat(400)).truncated).toBe(false);
  });
  it('does not split a surrogate pair at the cut', () => {
    const r = makeExcerpt('a'.repeat(399) + '\u{1F47B}' + 'b');
    expect(r.excerpt).toBe('a'.repeat(399));
    expect(r.truncated).toBe(true);
  });
  it('property: prefix of the collapsed body, length <= 400, no split pair, truncated iff longer', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 900 }), fc.fullUnicodeString({ maxLength: 500 })), body => {
        const { excerpt, truncated } = makeExcerpt(body);
        const c = collapse(body);
        expect(c.startsWith(excerpt)).toBe(true);
        expect(excerpt.length).toBeLessThanOrEqual(400);
        if (excerpt.length > 0) {
          const last = excerpt.charCodeAt(excerpt.length - 1);
          const splitPair = last >= 0xd800 && last <= 0xdbff && c.length > excerpt.length;
          expect(splitPair).toBe(false);
        }
        expect(truncated).toBe(c.length > excerpt.length);
      }),
    );
  });
});

describe('hasObituaryText and obituaryLine', () => {
  it('needs an excerpt, a title alone is not a reason', () => {
    expect(hasObituaryText(undefined)).toBe(false);
    expect(hasObituaryText(obit({ pr: null }))).toBe(false);
    expect(hasObituaryText(obit({ pr: ref({ excerpt: '' }) }))).toBe(false);
    expect(hasObituaryText(obit({ pr: null, issues: [ref({ number: 12, excerpt: 'why' })] }))).toBe(true);
    expect(hasObituaryText(obit())).toBe(true);
  });
  it('formats the PR line and falls back to the first issue with text', () => {
    expect(obituaryLine(obit(), 500)).toBe('Obituary (PR #5353): "A reason" https://github.com/psf/requests/pull/5353');
    expect(obituaryLine(obit({ pr: ref({ truncated: true }) }), 500)).toBe('Obituary (PR #5353): "A reason\u2026" https://github.com/psf/requests/pull/5353');
    const issue = ref({ number: 12, url: 'https://github.com/o/r/issues/12', excerpt: 'because' });
    expect(obituaryLine(obit({ pr: null, issues: [ref({ number: 11, excerpt: '' }), issue] }), 500)).toBe('Obituary (issue #12): "because" https://github.com/o/r/issues/12');
    expect(obituaryLine(obit({ pr: null }), 500)).toBe('');
  });
  it('shortens the excerpt with an ellipsis to fit', () => {
    const line = obituaryLine(obit({ pr: ref({ excerpt: 'word '.repeat(60).trim() }) }), 120);
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line).toContain('\u2026" https://github.com/psf/requests/pull/5353');
  });
  it('property: length <= max and empty iff no text', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 400 }), fc.boolean(), fc.integer({ min: 0, max: 600 }), (excerpt, truncated, max) => {
        const o = obit({ pr: ref({ excerpt: collapse(excerpt), truncated }) });
        const line = obituaryLine(o, max);
        expect(line.length).toBeLessThanOrEqual(max);
        if (!hasObituaryText(o)) expect(line).toBe('');
      }),
    );
  });
});

const cand = (number: number, merged: boolean, sha: string | null): PullCandidate => ({ ref: ref({ number }), merged, mergeCommitSha: sha });

describe('pickPullRequest', () => {
  const sha = 'a'.repeat(40);
  it('prefers the merged PR whose merge commit is the death commit, then the lowest merged, then the lowest', () => {
    expect(pickPullRequest([cand(9, true, 'b'), cand(5, true, sha), cand(2, true, 'c')], sha)?.ref.number).toBe(5);
    expect(pickPullRequest([cand(9, true, 'b'), cand(4, false, null), cand(7, true, 'c')], sha)?.ref.number).toBe(7);
    expect(pickPullRequest([cand(9, false, null), cand(4, false, null)], sha)?.ref.number).toBe(4);
    expect(pickPullRequest([], sha)).toBeUndefined();
  });
  it('property: deterministic and order independent', () => {
    const arb = fc.uniqueArray(fc.tuple(fc.integer({ min: 1, max: 50 }), fc.boolean(), fc.constantFrom<string | null>(null, sha, 'zz')), { selector: t => t[0], maxLength: 8 });
    fc.assert(
      fc.property(arb, fc.integer(), (rows, seed) => {
        const list = rows.map(([n, m, s]) => cand(n, m, s));
        const shuffled = [...list].sort((a, b) => ((a.ref.number * 31 + seed) % 17) - ((b.ref.number * 31 + seed) % 17));
        expect(pickPullRequest(shuffled, sha)).toEqual(pickPullRequest(list, sha));
        expect(pickPullRequest(list, sha)).toEqual(pickPullRequest(list, sha));
      }),
    );
  });
});

describe('GitHub JSON validation', () => {
  it('builds a ref from a good shape and rejects bad ones', () => {
    expect(entryFromGitHub({ number: 3, html_url: 'https://github.com/o/r/pull/3', title: 'T', body: 'a  b' })).toEqual({ number: 3, url: 'https://github.com/o/r/pull/3', title: 'T', excerpt: 'a b', truncated: false });
    expect(entryFromGitHub({ number: 3, html_url: 'u', title: 'T', body: null })?.excerpt).toBe('');
    expect(entryFromGitHub(null)).toBeNull();
    expect(entryFromGitHub([])).toBeNull();
    expect(entryFromGitHub({ number: '3', html_url: 'u', title: 'T' })).toBeNull();
    expect(entryFromGitHub({ number: 3, title: 'T' })).toBeNull();
    expect(entryFromGitHub({ number: 3, html_url: 'u', title: 'T', body: 5 })).toBeNull();
  });
  it('parses a pulls list and rejects a non-list or a bad element', () => {
    const good = { number: 3, html_url: 'u', title: 'T', body: 'x', merged_at: '2020-01-01T00:00:00Z', merge_commit_sha: 'abc' };
    expect(pullCandidatesFromGitHub([good])?.[0]).toMatchObject({ merged: true, mergeCommitSha: 'abc' });
    expect(pullCandidatesFromGitHub([{ ...good, merged_at: null, merge_commit_sha: null }])?.[0]).toMatchObject({ merged: false, mergeCommitSha: null });
    expect(pullCandidatesFromGitHub({})).toBeNull();
    expect(pullCandidatesFromGitHub([good, { number: 1 }])).toBeNull();
    expect(pullCandidatesFromGitHub([])).toEqual([]);
  });
});
