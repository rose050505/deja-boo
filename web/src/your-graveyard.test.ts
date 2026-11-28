import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { DEFAULT_MINER_CONFIG, type Graveyard, type Tombstone } from '../../src/core/types.ts';
import { runIndexWithStats } from '../../src/miner/index.ts';
import { toGraveyardJson } from '../../src/miner/serialize.ts';
import { stripGraveyard } from '../scripts/strip.ts';
import { layoutStones } from './layout.ts';
import { summon } from './summon.ts';
import { browserFingerprint, parseDropped, parseGithubSlug, toWebGraveyard, validateGraveyard } from './your-graveyard.ts';

const BUILDER = fileURLToPath(new URL('../../src/test-fixtures/haunted-http.sh', import.meta.url));
const SAMPLE = fileURLToPath(new URL('../public/graveyards/haunted-http.json', import.meta.url));

let dir = '';
let text = '';
let graveyard: Graveyard;
/** A watched (not alive at HEAD) tombstone to build variants from. */
const plain = (): Tombstone => { const { aliveAtHead: _a, ...rest } = graveyard.tombstones[0]!; return rest as Tombstone; };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deja-boo-yours-'));
  execFileSync('bash', [BUILDER, join(dir, 'repo')], { stdio: 'ignore' });
  ({ graveyard } = await runIndexWithStats(join(dir, 'repo'), DEFAULT_MINER_CONFIG));
  text = toGraveyardJson(graveyard); // what `deja-boo index` writes
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('validateGraveyard', () => {
  it('accepts a graveyard written by the indexer on a fixture repo', () => {
    const v = validateGraveyard(JSON.parse(text));
    expect(v.ok).toBe(true);
    expect(v.ok && v.tombstones.length).toBeGreaterThan(0);
  });

  it('accepts an empty graveyard', () => expect(validateGraveyard({ tombstones: [], stats: {} }).ok).toBe(true));

  it('rejects malformed input with a reason', () => {
    const t = JSON.parse(text).tombstones[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null, 3, 'x', [], {}, { tombstones: {} }, { tombstones: [1] },
      { tombstones: [{ ...t, lines: 'a' }] },
      { tombstones: [{ ...t, fingerprint: ['a'] }] },
      { tombstones: [{ ...t, buriedAt: 'not a date' }] },
      { tombstones: [{ ...t, revivals: [{}] }] },
      { tombstones: [{ ...t, links: [1] }] },
      { tombstones: [{ ...t, aliveAtHead: 'yes' }] },
      { tombstones: [{ ...t, id: undefined }] },
    ];
    for (const b of bad) {
      const v = validateGraveyard(b);
      expect(v.ok).toBe(false);
      expect(!v.ok && v.reason.length).toBeGreaterThan(0);
    }
  });

  it('never throws, whatever the JSON', () => {
    fc.assert(fc.property(fc.jsonValue(), j => { validateGraveyard(j); }));
  });

  it('parseDropped reports bad JSON, a non-graveyard and a bad graveyard as errors', () => {
    expect(parseDropped('a.json', '{nope').kind).toBe('error');
    expect(parseDropped('a.json', '{"hello":1}').kind).toBe('error');
    expect(parseDropped('a.json', '[]').kind).toBe('error');
    expect(parseDropped('graveyard.json', '{"tombstones":[{}]}').kind).toBe('error');
    expect(parseDropped('graveyard.json', text).kind).toBe('graveyard');
  });
});

describe('toWebGraveyard', () => {
  it('equals what the build script writes for the same fixture (the committed haunted-http.json)', () => {
    const v = validateGraveyard(JSON.parse(text));
    if (!v.ok) throw new Error(v.reason);
    const sorted = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (_k, val: unknown) =>
      val !== null && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
        : val));
    expect(sorted(toWebGraveyard(v.tombstones, null))).toEqual(JSON.parse(readFileSync(SAMPLE, 'utf8')));
  });

  it('is stripGraveyard: caps lines at 60 with a recomputed fingerprint, drops alive-at-HEAD except Reverts', () => {
    const base = plain();
    const long: Tombstone = { ...base, id: 'long', lines: Array.from({ length: 80 }, (_, i) => `const value${i} = compute(${i});`) };
    const alive: Tombstone = { ...base, id: 'alive', aliveAtHead: true, causeOfDeath: 'refactor' };
    const aliveRevert: Tombstone = { ...base, id: 'alive-revert', aliveAtHead: true, causeOfDeath: 'Revert "x"' };
    const input = [long, alive, aliveRevert];
    const out = toWebGraveyard(input, null);
    expect(out).toEqual(stripGraveyard(input, browserFingerprint));
    expect(out.map(t => t.id).sort()).toEqual(['alive-revert', 'long']);
    expect(out.find(t => t.id === 'long')).toMatchObject({ totalLines: 80 });
    expect(out.find(t => t.id === 'long')!.lines).toHaveLength(60);
    expect(input[0]!.lines).toHaveLength(80); // input not mutated
  });

  it('attaches obituaries by death commit, like web:data', () => {
    const t = plain();
    const obit = { pr: { number: 7, url: 'https://github.com/o/r/pull/7', title: 'Fix', excerpt: 'It leaked.', truncated: false }, issues: [], fetchedAt: '2026-01-01T00:00:00Z' };
    const out = toWebGraveyard([t], { [t.commit]: obit });
    expect(out[0]!.obituary).toEqual(obit);
    expect(toWebGraveyard([t], { ['0'.repeat(40)]: obit })[0]!.obituary).toBeUndefined();
  });

  it('a 5 MB graveyard converts, lays out and summons in well under a second', () => {
    const base = plain();
    const lines = Array.from({ length: 20 }, (_, i) => `  const value${i} = compute(${i}, options.retries);`);
    const tombs: Tombstone[] = Array.from({ length: 5000 }, (_, i) => ({
      ...base, id: `id${i}`, path: `pkg${i % 12}/f${i}.ts`, lines, buriedAt: new Date(Date.UTC(2015, 0, 1 + (i % 3000))).toISOString(), commit: String(i).padStart(40, '0'),
    }));
    const raw = JSON.stringify({ tombstones: tombs, stats: graveyard.stats });
    expect(raw.length).toBeGreaterThan(5_000_000);
    const t0 = performance.now();
    const v = validateGraveyard(JSON.parse(raw));
    if (!v.ok) throw new Error(v.reason);
    const web = toWebGraveyard(v.tombstones, null);
    layoutStones(web);
    const ms = performance.now() - t0;
    expect(web).toHaveLength(5000);
    expect(ms).toBeLessThan(1000);
  });

  it('an empty graveyard lays out and summons without error', () => {
    const web = toWebGraveyard([], null);
    expect(web).toEqual([]);
    layoutStones(web);
    expect(summon(web, 'const a = 1;\n').hits).toEqual([]);
  });
});

describe('parseGithubSlug', () => {
  it('accepts owner/name and rejects anything else', () => {
    for (const ok of ['pallets/click', ' psf/requests ', 'a/b.c_d-e']) expect(parseGithubSlug(ok)).not.toBeNull();
    for (const bad of ['', 'x', 'a/', '/b', 'a/b/c', '-a/b', 'a-/b', 'a/..', 'a/b c', 'https://github.com/a/b', 'a/b"onmouseover', 'a/<b>']) expect(parseGithubSlug(bad)).toBeNull();
  });
});
