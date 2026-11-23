import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { DEMO_SNIPPET } from './demo-snippet.ts';
import { fogDensity, ghostOpacity, restLine, summon } from './summon.ts';
import type { WebTombstone } from './data.ts';

const demo = JSON.parse(readFileSync(new URL('../public/graveyards/haunted-http.json', import.meta.url), 'utf8')) as WebTombstone[];

describe('summon', () => {
  it('the haunted chunked upload hits the Revert stone and blocks', () => {
    const r = summon(demo, DEMO_SNIPPET);
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h.level).toBe('block');
    expect(h.similarity).toBeGreaterThanOrEqual(0.7);
    expect(h.tombstone.causeOfDeath).toMatch(/^Revert/);
    expect(h.matchedLines[0]).toBeGreaterThan(0);
  });

  it('property: acknowledging every hit makes them rest, and nothing else changes', () => {
    const r = summon(demo, DEMO_SNIPPET);
    const acked = summon(demo, `${DEMO_SNIPPET}\n# ${r.hits.map(h => `deja-boo: checked ${h.tombstone.id}`).join('\n# ')}`);
    expect(acked.hits).toHaveLength(0);
    expect(acked.rested.map(h => h.tombstone.id)).toEqual(r.hits.map(h => h.tombstone.id));
  });

  it('unrelated code raises nothing', () => {
    expect(summon(demo, 'def add(a, b):\n    return a + b\n').hits).toEqual([]);
    expect(summon(demo, '').hits).toEqual([]);
  });

  it('property: hits are sorted by similarity and levels respect thresholds', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 30 }), lines => {
        const r = summon(demo, [...lines, ...DEMO_SNIPPET.split('\n')].join('\n'));
        for (const h of r.hits) expect(h.similarity).toBeGreaterThanOrEqual(0.5);
        for (let i = 1; i < r.hits.length; i++) expect(r.hits[i - 1]!.similarity).toBeGreaterThanOrEqual(r.hits[i]!.similarity);
      }),
      { numRuns: 25 },
    );
  });
});

describe('visual mappings', () => {
  it('ghost opacity and fog are monotone and bounded', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(ghostOpacity(lo)).toBeLessThanOrEqual(ghostOpacity(hi));
      expect(ghostOpacity(a)).toBeGreaterThanOrEqual(0.25);
    }));
    fc.assert(fc.property(fc.nat(50), n => {
      expect(fogDensity(n)).toBeLessThanOrEqual(fogDensity(n + 1));
      expect(fogDensity(n)).toBeLessThanOrEqual(0.7);
    }));
  });
  it('rest line carries the id', () => {
    expect(restLine('abc')).toBe('If the reason no longer applies, let it rest: add `deja-boo: checked abc`');
  });
});
