import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DEFAULT_SKIP_PATTERNS, DOC_SKIP_PATTERNS, resolveSkipPatterns, shouldSkip, isSkippedPath } from './skip.js';

const D = DEFAULT_SKIP_PATTERNS;

describe('shouldSkip with default patterns', () => {
  it.each([
    'docs/api.html',
    'docs/a/b/api.html',
    'package-lock.json',
    'sub/yarn.lock',
    'Pipfile.lock',
    'dist/index.js',
    'packages/x/dist/a.js',
    'certs/cacert.pem',
    'a/b.crt',
    'requests/packages/urllib3/x.py',
    'logo.png',
    'node_modules/a/b.js',
    'CHANGELOG.md',
  ])('skips %s', p => expect(shouldSkip(p, D)).toBe(true));

  it.each([
    'src/index.ts',
    'docs/guide.ts',
    'mydocs/api.html',
    'packages/core/index.ts', // top-level monorepo packages are real code
    'lib/distribution.ts',
  ])('keeps %s', p => expect(shouldSkip(p, D)).toBe(false));
});

describe('resolveSkipPatterns', () => {
  it('prose docs are skipped by default and kept with includeDocs', () => {
    expect(shouldSkip('README.md', resolveSkipPatterns())).toBe(true);
    expect(shouldSkip('notes.rst', resolveSkipPatterns())).toBe(true);
    expect(shouldSkip('a/b.txt', resolveSkipPatterns())).toBe(true);
    expect(shouldSkip('README.md', resolveSkipPatterns({ includeDocs: true }))).toBe(false);
  });
  it('extra patterns add to defaults; defaults:false removes them', () => {
    const p = resolveSkipPatterns({ extra: ['gen/'] });
    expect(shouldSkip('gen/a.ts', p)).toBe(true);
    expect(shouldSkip('package-lock.json', p)).toBe(true);
    const none = resolveSkipPatterns({ extra: ['gen/'], defaults: false });
    expect(none).toEqual(['gen/']);
    expect(shouldSkip('package-lock.json', none)).toBe(false);
  });
  it('minified files and maps are skipped even with no patterns', () => {
    expect(isSkippedPath('a/b.min.js', [])).toBe(true);
    expect(isSkippedPath('a/b.js.map', [])).toBe(true);
  });
  it('property: no pattern list matches everything, an empty one matches nothing', () => {
    fc.assert(fc.property(fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,3}\.ts$/), p =>
      !shouldSkip(p, []) && !shouldSkip(p, [...D, ...DOC_SKIP_PATTERNS]),
    ));
  });
});
