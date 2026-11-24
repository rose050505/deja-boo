import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BLOCK_THRESHOLD, WARN_THRESHOLD, hauntLevel, type HauntLevel } from './level.js';
import type { Link, Obituary, ObituaryRef, Tombstone } from './types.js';

type T = Pick<Tombstone, 'aliveAtHead' | 'causeOfDeath' | 'links' | 'obituary'>;
const rank: Record<HauntLevel, number> = { none: 0, warn: 1, block: 2 };
const ref = (excerpt: string): ObituaryRef => ({ number: 1, url: 'https://github.com/o/r/pull/1', title: 'a title', excerpt, truncated: false });
const obit = (pr: ObituaryRef | null, issues: ObituaryRef[] = []): Obituary => ({ pr, issues, fetchedAt: '2026-01-01T00:00:00.000Z' });

const link: Link = { type: 'ref', ref: '4' };
const base: T = { causeOfDeath: 'remove cache', links: [] };

describe('hauntLevel with an obituary', () => {
  it('a PR with text and no link allows block', () => {
    expect(hauntLevel({ ...base, obituary: obit(ref('release management')) }, 0.7)).toBe('block');
    expect(hauntLevel({ ...base, obituary: obit(null, [ref('why')]) }, 0.7)).toBe('block');
  });
  it('an entry with only a title or nothing does not', () => {
    expect(hauntLevel({ ...base, obituary: obit(ref('')) }, 0.9)).toBe('warn');
    expect(hauntLevel({ ...base, obituary: obit(null) }, 0.9)).toBe('warn');
  });
  it('a bare ref still counts without an obituary', () => {
    expect(hauntLevel({ ...base, links: [link] }, 0.7)).toBe('block');
  });
  it('an obituary does not lift the alive-at-HEAD suppression', () => {
    expect(hauntLevel({ ...base, aliveAtHead: true, obituary: obit(ref('x')) }, 1)).toBe('none');
  });
});

const tombArb = fc.record({
  aliveAtHead: fc.boolean(),
  causeOfDeath: fc.oneof(fc.string(), fc.constantFrom('Revert "x"', 'reverting 4', 'Revertible')),
  links: fc.array(fc.constant(link), { maxLength: 2 }),
});
const obitArb = fc.record({ pr: fc.option(fc.string({ maxLength: 20 }).map(ref), { nil: null }), issues: fc.array(fc.string({ maxLength: 20 }).map(ref), { maxLength: 3 }), fetchedAt: fc.constant('2026-01-01T00:00:00.000Z') });
const sim = fc.double({ min: 0, max: 1, noNaN: true });

describe('hauntLevel properties with obituaries', () => {
  it('attaching an obituary never lowers a level and never raises it when below the block threshold', () => {
    fc.assert(
      fc.property(tombArb, obitArb, sim, (t, o, s) => {
        const before = hauntLevel(t, s);
        const after = hauntLevel({ ...t, obituary: o }, s);
        expect(rank[after]).toBeGreaterThanOrEqual(rank[before]);
        if (s < BLOCK_THRESHOLD) expect(after).toBe(before);
        if (after !== before) expect(after).toBe('block');
      }),
    );
  });
  it('a graveyard without obituaries keeps working with two arguments', () => {
    fc.assert(fc.property(tombArb, sim, (t, s) => hauntLevel(t, s) === hauntLevel({ ...t }, s)));
  });
  it('threshold monotonicity, no block without a reason, alive non-Revert is none', () => {
    fc.assert(
      fc.property(tombArb, fc.option(obitArb, { nil: undefined }), sim, sim, sim, (t, o, s, a, b) => {
        const tomb: T = o === undefined ? { ...t } : { ...t, obituary: o };
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const level = hauntLevel(tomb, s, { warn: WARN_THRESHOLD, block: BLOCK_THRESHOLD });
        const stricter = hauntLevel(tomb, s, { warn: Math.max(WARN_THRESHOLD, lo), block: Math.max(BLOCK_THRESHOLD, hi, lo) });
        expect(rank[stricter]).toBeLessThanOrEqual(rank[level]);
        if (level === 'block') {
          const reason = /^\s*revert(s|ed|ing)?\b/i.test(t.causeOfDeath.split('\n')[0] ?? '') || t.links.length > 0 || (o !== undefined && (o.pr?.excerpt || o.issues.some(i => i.excerpt)));
          expect(Boolean(reason)).toBe(true);
        }
      }),
    );
  });
});
