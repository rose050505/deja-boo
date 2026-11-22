import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { similarity } from './match.js';

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('similarity – unit', () => {
  it('similarity([], []) returns 0', () => {
    expect(similarity([], [])).toBe(0);
  });

  it('similarity(fp, fp) === 1 for a non-empty fingerprint', () => {
    expect(similarity([1, 2, 3], [1, 2, 3])).toBe(1);
  });

  it('no overlap returns 0', () => {
    expect(similarity([1, 2], [3, 4])).toBe(0);
  });

  it('partial overlap', () => {
    // |{1,2,3} ∩ {2,3,4}| = 2, |union| = 4 → 0.5
    expect(similarity([1, 2, 3], [2, 3, 4])).toBeCloseTo(0.5);
  });

  it('similarity([], x) === 0 for non-empty x', () => {
    expect(similarity([], [1, 2, 3])).toBe(0);
  });

  it('similarity(x, []) === 0 for non-empty x', () => {
    expect(similarity([1, 2, 3], [])).toBe(0);
  });

  it('single shared element', () => {
    // |{5} ∩ {5}| = 1, union = 1 → 1
    expect(similarity([5], [5])).toBe(1);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

/** Generate a sorted, deduplicated array of non-negative integers. */
const sortedFpArb = fc
  .array(fc.integer({ min: 0, max: 0xffffffff }), { minLength: 0, maxLength: 50 })
  .map(arr => Array.from(new Set(arr)).sort((a, b) => a - b));

describe('similarity – property tests', () => {
  it('Property 1: identity – similarity(fp, fp) === 1 for any non-empty fp', () => {
    fc.assert(
      fc.property(sortedFpArb, fp => {
        if (fp.length === 0) return true;
        return similarity(fp, fp) === 1;
      }),
      { numRuns: 1000 },
    );
  });

  it('Property 2: symmetry – similarity(a, b) === similarity(b, a)', () => {
    fc.assert(
      fc.property(sortedFpArb, sortedFpArb, (a, b) => {
        return similarity(a, b) === similarity(b, a);
      }),
      { numRuns: 1000 },
    );
  });

  it('Property 3: bounded – result is always in [0, 1]', () => {
    fc.assert(
      fc.property(sortedFpArb, sortedFpArb, (a, b) => {
        const s = similarity(a, b);
        return s >= 0 && s <= 1;
      }),
      { numRuns: 1000 },
    );
  });

  it('Property 4: monotonicity – pairs exceeding threshold t2 ⊆ pairs exceeding t1 (t1 < t2)', () => {
    fc.assert(
      fc.property(
        fc.array(sortedFpArb, { minLength: 2, maxLength: 6 }),
        fc.float({ min: 0, max: 0.5, noNaN: true }),
        fc.float({ min: 0.5, max: 1, noNaN: true }),
        (fps, t1, t2) => {
          if (t1 >= t2) return true; // precondition
          const exceedT1: string[] = [];
          const exceedT2: string[] = [];
          for (let i = 0; i < fps.length; i++) {
            for (let j = i + 1; j < fps.length; j++) {
              const s = similarity(fps[i] as number[], fps[j] as number[]);
              if (s > t1) exceedT1.push(`${i},${j}`);
              if (s > t2) exceedT2.push(`${i},${j}`);
            }
          }
          // Every pair exceeding t2 must also exceed t1 (since t1 < t2).
          return exceedT2.every(pair => exceedT1.includes(pair));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 5: empty – similarity([], x) === 0 for any x', () => {
    fc.assert(
      fc.property(sortedFpArb, x => {
        return similarity([], x) === 0;
      }),
      { numRuns: 500 },
    );
  });
});
