import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseGitHubRemote, parseRepoSlug, repoUrlOf } from './remote.js';

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/psf/requests', 'psf', 'requests'],
    ['https://github.com/psf/requests.git', 'psf', 'requests'],
    ['https://github.com/psf/requests/', 'psf', 'requests'],
    ['git@github.com:psf/requests.git', 'psf', 'requests'],
    ['git@github.com:psf/requests', 'psf', 'requests'],
    ['ssh://git@github.com/psf/requests.git', 'psf', 'requests'],
    ['https://user:secret@github.com/o/r.git', 'o', 'r'],
    ['https://GitHub.com/o/my.repo-x_1.git\n', 'o', 'my.repo-x_1'],
  ])('%s', (url, owner, name) => {
    expect(parseGitHubRemote(url)).toEqual({ owner, name });
  });

  it.each([
    '',
    'junk',
    'https://gitlab.com/o/r.git',
    'git@gitlab.com:o/r.git',
    'https://github.com.evil.example/o/r',
    'https://evil.example/github.com/o/r',
    'https://github.com/o',
    'https://github.com/o/r/extra',
    'http://github.com/o/r',
    '/home/me/repo',
    'git@github.com:o',
  ])('rejects %j', url => {
    expect(parseGitHubRemote(url)).toBeNull();
  });

  it('property: a parsed remote never carries credentials or .git into repoUrl', () => {
    const part = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
    fc.assert(fc.property(part, part, fc.constantFrom('', '.git'), fc.constantFrom('https://', 'https://u:p@', 'ssh://git@'), (o, r, ext, scheme) => {
      const repo = parseGitHubRemote(`${scheme}github.com/${o}/${r}${ext}`);
      expect(repo).toEqual({ owner: o, name: r });
      expect(repoUrlOf(repo!)).toBe(`https://github.com/${o}/${r}`);
    }));
  });
});

describe('parseRepoSlug', () => {
  it('accepts owner/name only', () => {
    expect(parseRepoSlug('psf/requests')).toEqual({ owner: 'psf', name: 'requests' });
    for (const bad of ['', 'psf', 'a/b/c', 'https://github.com/a/b', 'a b/c', '/a/b']) expect(parseRepoSlug(bad)).toBeNull();
  });
});
