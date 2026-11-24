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

describe('lock files (post-review fixes 3)', () => {
  it.each(['uv.lock', 'bun.lock', 'bun.lockb', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'pnpm-lock.yaml', 'sub/dir/uv.lock', 'flake.lock'])('%s is skipped by default', f => {
    expect(isSkippedPath(f, resolveSkipPatterns())).toBe(true);
  });
  it('source files that merely mention lock are not skipped', () => {
    for (const f of ['src/lock.ts', 'src/unlock.lockfile.ts', 'locker.py']) expect(isSkippedPath(f, resolveSkipPatterns())).toBe(false);
  });
});

describe('legal files and generated data (post-review fixes 5)', () => {
  it.each(['LICENSE', 'LICENSE.md', 'sub/LICENCE', 'COPYING', 'COPYING.LESSER', 'NOTICE', 'AUTHORS', 'CHANGES.rst', 'HISTORY.md', 'docs/data/sponsors.json', 'a/contributors.json'])('%s is skipped by default', f => {
    expect(isSkippedPath(f, resolveSkipPatterns())).toBe(true);
  });
  it('source files with similar names are not skipped', () => {
    for (const f of ['src/license.ts', 'src/notice-board.ts', 'src/authors.ts', 'src/sponsors.ts', 'data/sponsors.json.ts', 'src/changes.ts']) expect(isSkippedPath(f, resolveSkipPatterns())).toBe(false);
  });
});
