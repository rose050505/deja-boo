import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { epitaph, isCracked, layoutStones, stoneWidth, topDir, type StoneInput } from './layout.ts';

const item = fc.record({
  id: fc.uuid(),
  path: fc.constantFrom('src/a.ts', 'src/b/c.ts', 'test/x.js', 'README.rst', 'lib/z.py'),
  buriedAt: fc.integer({ min: 1_300_000_000_000, max: 1_800_000_000_000 }).map(ms => new Date(ms).toISOString()),
  causeOfDeath: fc.string({ maxLength: 40 }),
  lines: fc.array(fc.constant('x'), { minLength: 1, maxLength: 80 }),
});

describe('layoutStones', () => {
  it('property: stones stay inside the canvas, never overlap in a row, and layout is deterministic', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 60 }), (items: StoneInput[]) => {
        const a = layoutStones(items);
        expect(layoutStones([...items].reverse())).toEqual(a);
        expect(a.stones).toHaveLength(items.length);
        for (const s of a.stones) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w).toBeLessThanOrEqual(a.width);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y + s.h).toBeLessThanOrEqual(a.height);
        }
        for (let i = 0; i < a.stones.length; i++) {
          for (let j = i + 1; j < a.stones.length; j++) {
            const p = a.stones[i]!;
            const q = a.stones[j]!;
            if (p.row !== q.row) continue;
            const apartX = p.x + p.w <= q.x || q.x + q.w <= p.x;
            const apartY = p.y + p.h <= q.y || q.y + q.h <= p.y;
            expect(apartX || apartY).toBe(true);
          }
        }
      }),
    );
  });

  it('property: later burial never lands left of an earlier one in the same row and lane order', () => {
    const r = layoutStones([
      { id: 'a', path: 'src/a.ts', buriedAt: '2020-01-01T00:00:00Z', causeOfDeath: '', lines: ['x'] },
      { id: 'b', path: 'src/b.ts', buriedAt: '2024-01-01T00:00:00Z', causeOfDeath: '', lines: ['x'] },
    ]);
    expect(r.stones.find(s => s.id === 'b')!.x).toBeGreaterThan(r.stones.find(s => s.id === 'a')!.x);
  });
});

describe('helpers', () => {
  it('stoneWidth grows with lines (monotone)', () => {
    fc.assert(fc.property(fc.nat(500), fc.nat(500), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(stoneWidth(lo)).toBeLessThanOrEqual(stoneWidth(hi));
    }));
  });
  it('epitaph uses the first line and always ends with the date', () => {
    expect(epitaph({ causeOfDeath: 'Remove retries\n\nbecause it leaked', buriedAt: '2025-03-02T10:00:00+09:00' })).toBe('Remove retries · 2025-03-02');
    expect(epitaph({ causeOfDeath: '', buriedAt: '2025-03-02T10:00:00Z' })).toBe('cause of death unknown · 2025-03-02');
    fc.assert(fc.property(fc.string(), cause => {
      expect(epitaph({ causeOfDeath: cause, buriedAt: '2021-05-06T00:00:00Z' }).endsWith(' · 2021-05-06')).toBe(true);
    }));
  });
  it('cracks only Revert deaths; topDir handles root files', () => {
    expect(isCracked({ causeOfDeath: 'Revert "x"' })).toBe(true);
    expect(isCracked({ causeOfDeath: 'Remove x' })).toBe(false);
    expect(topDir('a/b/c.ts')).toBe('a');
    expect(topDir('c.ts')).toBe('(root)');
  });
});
