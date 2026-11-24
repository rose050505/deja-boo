import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { checkSnippet, getTombstone, listGraveyard, ToolError } from './tools.js';
import { fingerprintLines } from '../core/match.js';
import type { Graveyard, Tombstone } from '../core/types.js';
import { DEFAULT_THRESHOLDS } from '../watch/load.js';

const block = (tag: string): string[] =>
  Array.from({ length: 10 }, (_, i) => `  const ${tag}${i} = ${tag}Call${i}(arg${i}, ${i * 7}, opts.${tag});`);

function stone(id: string, ts: number, over: Partial<Tombstone> = {}): Tombstone {
  const lines = over.lines ?? block('alpha');
  return {
    id, fingerprint: fingerprintLines(lines), lines, path: 'src/a.ts', language: 'typescript',
    buriedAt: new Date(ts * 1000).toISOString(), buriedAtTimestamp: ts, commit: 'c'.repeat(40), author: 'x@y',
    causeOfDeath: 'leaked memory (PR #42)', links: [{ type: 'pr', ref: '42' }], revivals: [], deaths: [], ...over,
  };
}
const yard = (...tombstones: Tombstone[]): Graveyard => ({ tombstones, stats: {} as Graveyard['stats'] });
const T = DEFAULT_THRESHOLDS;

describe('checkSnippet', () => {
  const g = yard(stone('a'.repeat(40), 100), stone('b'.repeat(40), 200, { lines: block('beta'), path: 'lib/b.ts', causeOfDeath: '' , links: [] }));

  it('returns the REQ-6 fields for a match', () => {
    const r = checkSnippet(g, T, ['// pad', ...block('alpha')].join('\n'));
    expect(r.level).toBe('block');
    expect(r.revenants).toHaveLength(1);
    expect(r.revenants[0]).toEqual({
      id: 'a'.repeat(40), level: 'block', similarity: 1, containment: 1, matchedLines: [2, 11], path: 'src/a.ts',
      commit: 'c'.repeat(40), buriedAt: new Date(100000).toISOString(), causeOfDeath: 'leaked memory (PR #42)', links: [{ type: 'pr', ref: '42' }],
    });
  });
  it('empty cause is reported as "cause of death unknown"; no evidence means warn', () => {
    const r = checkSnippet(g, T, block('beta').join('\n'));
    expect(r.level).toBe('warn');
    expect(r.revenants[0]?.causeOfDeath).toBe('cause of death unknown');
  });
  it('none for unrelated code and for a skipped path', () => {
    expect(checkSnippet(g, T, 'const a = 1;')).toEqual({ level: 'none', revenants: [] });
    expect(checkSnippet(g, T, block('alpha').join('\n'), 'dist/x.js')).toEqual({ level: 'none', revenants: [] });
  });
  it('honours the thresholds it is given', () => {
    const edited = block('alpha').slice(0, 7).join('\n');
    expect(checkSnippet(g, { warn: 0.99, block: 1 }, edited).level).toBe('none');
  });
});

describe('getTombstone', () => {
  const g = yard(stone('a'.repeat(40), 100), stone('b'.repeat(40), 200, { causeOfDeath: ' ' }));
  it('returns every history field', () => {
    const t = getTombstone(g, 'a'.repeat(40));
    expect(t.lines).toEqual(block('alpha'));
    expect(t).toMatchObject({ commit: 'c'.repeat(40), revivals: [], deaths: [], aliveAtHead: false, causeOfDeath: 'leaked memory (PR #42)' });
  });
  it('empty cause reads "cause of death unknown"', () => {
    expect(getTombstone(g, 'b'.repeat(40)).causeOfDeath).toBe('cause of death unknown');
  });
  it('unknown id throws "no tombstone with id <id>"', () => {
    expect(() => getTombstone(g, 'zzz')).toThrow(ToolError);
    expect(() => getTombstone(g, 'zzz')).toThrow('no tombstone with id zzz');
  });
});

describe('listGraveyard', () => {
  const g = yard(
    stone('1'.repeat(40), 100, { path: 'src/a.ts' }),
    stone('2'.repeat(40), 300, { path: 'src/deep/b.ts' }),
    stone('3'.repeat(40), 300, { path: 'srcother/c.ts' }),
    stone('4'.repeat(40), 200, { path: 'src', aliveAtHead: true }),
  );
  it('newest first, ties by id, summary fields only', () => {
    const r = listGraveyard(g);
    expect(r.map(x => x.id[0])).toEqual(['2', '3', '4', '1']);
    expect(Object.keys(r[0]!).sort()).toEqual(['aliveAtHead', 'buriedAt', 'causeOfDeath', 'commit', 'id', 'lineCount', 'links', 'path']);
    expect(r[0]!.lineCount).toBe(10);
    expect(r[2]!.aliveAtHead).toBe(true);
  });
  it('path matches equal or prefix/ only', () => {
    expect(listGraveyard(g, { path: 'src' }).map(x => x.id[0])).toEqual(['2', '4', '1']);
    expect(listGraveyard(g, { path: 'src/' }).map(x => x.id[0])).toEqual(['2', '4', '1']);
    expect(listGraveyard(g, { path: 'src/a.ts' }).map(x => x.id[0])).toEqual(['1']);
  });
  it('limit defaults to 20 and is capped at 100', () => {
    const many = yard(...Array.from({ length: 150 }, (_, i) => stone(String(i).padStart(40, '0'), i)));
    expect(listGraveyard(many)).toHaveLength(20);
    expect(listGraveyard(many, { limit: 500 })).toHaveLength(100);
    expect(listGraveyard(many, { limit: 3 })).toHaveLength(3);
    expect(listGraveyard(many, { limit: 0 })).toHaveLength(0);
  });
  it('property: length <= min(limit, 100) and sorted newest first', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 150 }),
      fc.option(fc.integer({ min: -5, max: 300 }), { nil: undefined }),
      (stamps, limit) => {
        const gy = yard(...stamps.map((ts, i) => stone(String(i).padStart(40, '0'), ts)));
        const r = listGraveyard(gy, { limit });
        expect(r.length).toBeLessThanOrEqual(Math.min(Math.max(limit ?? 20, 0), 100));
        const ts = r.map(x => Date.parse(x.buriedAt));
        for (let i = 1; i < ts.length; i++) expect(ts[i - 1]!).toBeGreaterThanOrEqual(ts[i]!);
      },
    ));
  });
});

describe('checkSnippet with `before` (HEAD version of the path)', () => {
  const g = yard(stone('a'.repeat(40), 100));
  const code = block('alpha').join('\n');
  it('code that is already in the before text does not alarm; new code does', () => {
    expect(checkSnippet(g, T, code, 'src/a.ts', { before: code }).level).toBe('none');
    expect(checkSnippet(g, T, code, 'src/a.ts', { before: '' }).level).toBe('block');
    expect(checkSnippet(g, T, code, 'src/a.ts', { before: 'const x = 1;' }).level).toBe('block');
    expect(checkSnippet(g, T, code, 'src/a.ts').level).toBe('block');
  });
  it('minHashes above the fingerprint size hides the tombstone', () => {
    expect(checkSnippet(g, T, code, undefined, { minHashes: 10_000 }).level).toBe('none');
  });
});
