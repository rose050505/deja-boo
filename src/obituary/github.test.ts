import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createGitHubFetcher, resolveToken } from './github.js';

const TOKEN = 'ghp_SECRET_TOKEN_1234567890';

function stubFetch(res: Response | Error): { calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal('fetch', async (url: URL | string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
    if (res instanceof Error) throw res;
    return res;
  });
  return { calls };
}
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe('createGitHubFetcher', () => {
  it('sends the GitHub headers, the token only to api.github.com, and returns the JSON', async () => {
    const { calls } = stubFetch(reply(200, [{ a: 1 }]));
    const out = await createGitHubFetcher(TOKEN)('/repos/o/r/issues/1');
    expect(out).toEqual({ kind: 'ok', json: [{ a: 1 }] });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/issues/1');
    expect(calls[0]?.headers).toMatchObject({ Accept: 'application/vnd.github+json', 'User-Agent': 'deja-boo', Authorization: `Bearer ${TOKEN}` });
    expect(calls[0]?.headers['X-GitHub-Api-Version']).toBeTruthy();
  });

  it('sends no Authorization header without a token', async () => {
    const { calls } = stubFetch(reply(200, {}));
    await createGitHubFetcher()('/repos/o/r/issues/1');
    expect(calls[0]?.headers).not.toHaveProperty('Authorization');
  });

  it('never sends the token to another host, even for a crafted path', async () => {
    const { calls } = stubFetch(reply(200, {}));
    const f = createGitHubFetcher(TOKEN);
    await f('//evil.example/x');
    await f('https://evil.example/x');
    await f('relative');
    for (const c of calls) {
      if (!c.url.startsWith('https://api.github.com/')) expect(c.headers).not.toHaveProperty('Authorization');
    }
    expect(calls.every(c => new URL(c.url).origin !== 'https://evil.example' || !('Authorization' in c.headers))).toBe(true);
  });

  it('maps 403 with remaining 0, 403 with retry-after, and 429 to rate-limited, with a reset time when announced', async () => {
    stubFetch(reply(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767326400' }));
    expect(await createGitHubFetcher(TOKEN)('/x')).toEqual({ kind: 'rate-limited', resetAt: '2026-01-02T04:00:00.000Z' });
    stubFetch(reply(403, {}, { 'retry-after': '60' }));
    expect((await createGitHubFetcher(TOKEN)('/x')).kind).toBe('rate-limited');
    stubFetch(reply(429, {}));
    expect(await createGitHubFetcher(TOKEN)('/x')).toEqual({ kind: 'rate-limited' });
  });

  it('maps 404, 5xx, a plain 403, bad JSON and network errors to error; the token never appears in a message', async () => {
    const f = createGitHubFetcher(TOKEN);
    const outcomes = [];
    for (const res of [reply(404, {}), reply(500, {}), reply(403, {}, { 'x-ratelimit-remaining': '12' }), reply(200, 'not json'), new Error(`boom with ${TOKEN} inside`)]) {
      stubFetch(res);
      outcomes.push(await f(`/repos/o/r/${TOKEN}`));
    }
    expect(outcomes.map(o => o.kind)).toEqual(['error', 'error', 'error', 'error', 'error']);
    expect(outcomes[0]).toMatchObject({ status: 404 });
    expect(outcomes[1]).toMatchObject({ status: 500 });
    expect(JSON.stringify(outcomes)).not.toContain(TOKEN);
  });
});

describe('resolveToken', () => {
  it('prefers GITHUB_TOKEN and does not run gh then', () => {
    let ran = false;
    expect(resolveToken({ GITHUB_TOKEN: ' abc ' }, () => ((ran = true), 'gh'))).toBe('abc');
    expect(ran).toBe(false);
  });
  it('falls back to gh (trimmed), then to none', () => {
    expect(resolveToken({}, () => 'ghtoken\n')).toBe('ghtoken');
    expect(resolveToken({ GITHUB_TOKEN: '' }, () => 'ghtoken')).toBe('ghtoken');
    expect(resolveToken({}, () => null)).toBeUndefined();
    expect(resolveToken({ GITHUB_TOKEN: '  ' }, () => '\n')).toBeUndefined();
  });
});

describe('network code lives in one file', () => {
  it('source scan: fetch( only in src/obituary/github.ts', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && /(^|[^\w.])fetch\(/.test(readFileSync(p, 'utf8'))) offenders.push(relative(root, p));
      }
    };
    walk(join(root, 'src'));
    expect(offenders).toEqual(['src/obituary/github.ts']);
  });
});
