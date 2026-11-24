import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIndex } from './index.js';
import { toGraveyardJson } from './serialize.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { Graveyard } from '../core/types.js';

const BUILDER = fileURLToPath(new URL('../test-fixtures/haunted-http.sh', import.meta.url));
const GOLDEN = fileURLToPath(new URL('../../web/public/graveyards/haunted-http.json', import.meta.url));
const CFG = { ...DEFAULT_MINER_CONFIG, graceDays: 0 };

describe('repoUrl in the graveyard (REQ-4)', () => {
  let dir: string;
  let repo: string;
  let without: Graveyard;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-origin-'));
    repo = join(dir, 'repo');
    execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' });
    without = await runIndex(repo, CFG);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('no origin: no repoUrl key, and the tombstones equal the committed haunted-http web file', () => {
    expect('repoUrl' in without).toBe(false);
    expect(toGraveyardJson(without)).not.toContain('repoUrl');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Array<{ id: string; commit: string; causeOfDeath: string; links: unknown; lines: string[] }>;
    const got = without.tombstones.filter(t => golden.some(g => g.id === t.id));
    expect(got.map(t => ({ id: t.id, commit: t.commit, causeOfDeath: t.causeOfDeath, links: t.links, lines: t.lines })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual(golden.map(g => ({ id: g.id, commit: g.commit, causeOfDeath: g.causeOfDeath, links: g.links, lines: g.lines })).sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('a GitHub origin sets repoUrl and gives links a URL; a non-GitHub origin does not', async () => {
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], { cwd: repo });
    const withOrigin = await runIndex(repo, CFG);
    expect(withOrigin.repoUrl).toBe('https://github.com/o/r');
    const links = withOrigin.tombstones.flatMap(t => t.links);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.url).toBe(`https://github.com/o/r/issues/${l.ref}`);
    expect(Object.keys(JSON.parse(toGraveyardJson(withOrigin)) as object)).toEqual(['repoUrl', 'stats', 'tombstones']);

    execFileSync('git', ['remote', 'set-url', 'origin', 'https://gitlab.com/o/r.git'], { cwd: repo });
    expect('repoUrl' in (await runIndex(repo, CFG))).toBe(false);
  });
});
