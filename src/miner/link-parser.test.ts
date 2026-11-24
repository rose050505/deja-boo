import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseLinks } from './link-parser.js';

describe('parseLinks', () => {
  it('empty message returns []', () => {
    expect(parseLinks('')).toEqual([]);
    expect(parseLinks('   ')).toEqual([]);
  });

  it('bare #42 → issue ref', () => {
    expect(parseLinks('fixes #42')).toEqual([{ type: 'issue', ref: '42' }]);
  });

  it('"closes #10, resolves #11" → two links', () => {
    const links = parseLinks('closes #10, resolves #11');
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ type: 'issue', ref: '10' });
    expect(links[1]).toEqual({ type: 'issue', ref: '11' });
  });

  it('full GitHub pull URL → pr type', () => {
    const url = 'https://github.com/owner/repo/pull/55';
    const links = parseLinks(`see ${url}`);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ type: 'pr', ref: '55', url });
  });

  it('full GitHub issue URL → issue type', () => {
    const url = 'https://github.com/owner/repo/issues/99';
    const links = parseLinks(`ref ${url}`);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ type: 'issue', ref: '99', url });
  });

  it('same ref appearing as bare + URL is deduplicated to one entry', () => {
    const url = 'https://github.com/owner/repo/issues/7';
    const msg = `fixes #7, see ${url}`;
    const links = parseLinks(msg);
    // The URL version is found first and stored with url; bare #7 is then deduped.
    expect(links.filter(l => l.ref === '7')).toHaveLength(1);
  });

  it('no duplicates when keyword and bare ref reference same number', () => {
    const links = parseLinks('closes #5 and also #5');
    expect(links.filter(l => l.ref === '5')).toHaveLength(1);
  });

  it('multiple refs in one message are all captured', () => {
    const links = parseLinks('see #1, #2, fixes #3');
    const refs = links.map(l => l.ref);
    expect(refs).toContain('1');
    expect(refs).toContain('2');
    expect(refs).toContain('3');
  });

  it('case-insensitive close keywords', () => {
    expect(parseLinks('Fixes #10')).toHaveLength(1);
    expect(parseLinks('CLOSES #20')).toHaveLength(1);
    expect(parseLinks('Resolves #30')).toHaveLength(1);
  });

  it('ref inside a URL path is not treated as a bare ref', () => {
    // The /issues/12 part should not also produce an extra bare-ref match.
    const url = 'https://github.com/owner/repo/issues/12';
    const links = parseLinks(url);
    expect(links).toHaveLength(1);
    expect(links[0]?.ref).toBe('12');
  });

  it('a bare #N is a ref, not an issue', () => {
    expect(parseLinks('see #42')).toEqual([{ type: 'ref', ref: '42' }]);
  });

  it('PR #5 then a later bare #5 yields one link (most specific kind wins)', () => {
    const url = 'https://github.com/o/r/pull/5';
    expect(parseLinks(`#5 and ${url}`)).toEqual([{ type: 'pr', ref: '5', url }]);
    expect(parseLinks('fixes #5, see #5')).toEqual([{ type: 'issue', ref: '5' }]);
  });

  it('with repoUrl, bare and close-keyword links get an issues URL; URL forms keep theirs', () => {
    const repo = 'https://github.com/o/r';
    const pr = 'https://github.com/x/y/pull/9';
    expect(parseLinks(`${pr} fixes #1 and #2`, repo)).toEqual([
      { type: 'pr', ref: '9', url: pr },
      { type: 'issue', ref: '1', url: `${repo}/issues/1` },
      { type: 'ref', ref: '2', url: `${repo}/issues/2` },
    ]);
  });
});

const refArb = fc.integer({ min: 1, max: 30 });
const messageArb = fc.array(
  fc.oneof(
    refArb.map(n => `#${n}`),
    refArb.map(n => `fixes #${n}`),
    refArb.map(n => `https://github.com/a/b/pull/${n}`),
    refArb.map(n => `https://github.com/a/b/issues/${n}`),
    fc.string({ maxLength: 8 }),
  ),
  { maxLength: 8 },
).map(parts => parts.join(' '));

describe('parseLinks properties', () => {
  it('never returns two links with the same ref', () => {
    fc.assert(fc.property(messageArb, fc.option(fc.constant('https://github.com/o/r'), { nil: undefined }), (msg, repo) => {
      const refs = parseLinks(msg, repo).map(l => l.ref);
      expect(new Set(refs).size).toBe(refs.length);
    }));
  });
  it('a bare #N alone is ref; with repoUrl every link has a url, without it only URL-form links do', () => {
    fc.assert(fc.property(messageArb, msg => {
      const repo = 'https://github.com/o/r';
      for (const l of parseLinks(msg, repo)) expect(l.url).toBeDefined();
      for (const l of parseLinks(msg)) expect(l.url !== undefined).toBe(l.type === 'pr' || /github\.com\/a\/b\/(issues|pull)\//.test(l.url ?? ''));
      for (const n of [1, 2, 3]) expect(parseLinks(`#${n}`)).toEqual([{ type: 'ref', ref: String(n) }]);
    }));
  });
});
