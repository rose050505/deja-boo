import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fnv1a32, kgramWinnow } from './fingerprint.js';

/** Jaccard similarity used locally for property tests (will move to match.ts). */
function jaccardSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  let intersection = 0;
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const av = a[i] as number;
    const bv = b[j] as number;
    if (av === bv) { intersection++; i++; j++; }
    else if (av < bv) i++;
    else j++;
  }
  const union = a.length + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

const cfg = { kgramSize: 3, windowSize: 2 };

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('fnv1a32 – unit', () => {
  it('is deterministic', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
  });

  it('different inputs produce different hashes (spot check)', () => {
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('empty string returns the FNV offset basis', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });
});

describe('kgramWinnow – unit', () => {
  it('fewer tokens than k returns []', () => {
    expect(kgramWinnow('a b', { kgramSize: 3, windowSize: 2 })).toEqual([]);
  });

  it('exactly k tokens returns a non-empty array', () => {
    const fp = kgramWinnow('a b c', { kgramSize: 3, windowSize: 2 });
    expect(fp.length).toBeGreaterThan(0);
  });

  it('result is sorted ascending', () => {
    const fp = kgramWinnow('the quick brown fox jumps over lazy dog', cfg);
    for (let i = 1; i < fp.length; i++) {
      expect((fp[i] as number)).toBeGreaterThanOrEqual(fp[i - 1] as number);
    }
  });

  it('result has no duplicates', () => {
    const fp = kgramWinnow('the quick brown fox jumps over lazy dog', cfg);
    expect(new Set(fp).size).toBe(fp.length);
  });

  it('identical text produces identical fingerprint', () => {
    const text = 'function add a b return a plus b end';
    expect(kgramWinnow(text, cfg)).toEqual(kgramWinnow(text, cfg));
  });

  it('single token returns []', () => {
    expect(kgramWinnow('hello', cfg)).toEqual([]);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

const textArb = fc.string({ minLength: 0, maxLength: 200 });
const cfgArb = fc.record({
  kgramSize: fc.integer({ min: 2, max: 8 }),
  windowSize: fc.integer({ min: 2, max: 6 }),
});

describe('kgramWinnow – property tests', () => {
  it('Property 1: determinism – two calls on same text return deeply equal arrays', () => {
    fc.assert(
      fc.property(textArb, cfgArb, (text, c) => {
        const fp1 = kgramWinnow(text, c);
        const fp2 = kgramWinnow(text, c);
        return JSON.stringify(fp1) === JSON.stringify(fp2);
      }),
      { numRuns: 500 },
    );
  });

  it('Property 2: self-similarity – jaccardSimilarity(fp, fp) === 1 for non-empty fp', () => {
    fc.assert(
      fc.property(textArb, cfgArb, (text, c) => {
        const fp = kgramWinnow(text, c);
        if (fp.length === 0) return true; // empty fingerprint is acceptable
        return jaccardSimilarity(fp, fp) === 1;
      }),
      { numRuns: 500 },
    );
  });

  it('Property 3: symmetry – jaccardSimilarity(a, b) === jaccardSimilarity(b, a)', () => {
    fc.assert(
      fc.property(textArb, textArb, cfgArb, (t1, t2, c) => {
        const a = kgramWinnow(t1, c);
        const b = kgramWinnow(t2, c);
        return jaccardSimilarity(a, b) === jaccardSimilarity(b, a);
      }),
      { numRuns: 500 },
    );
  });

  it('Property 4: bounded – jaccardSimilarity result is in [0, 1]', () => {
    fc.assert(
      fc.property(textArb, textArb, cfgArb, (t1, t2, c) => {
        const a = kgramWinnow(t1, c);
        const b = kgramWinnow(t2, c);
        const s = jaccardSimilarity(a, b);
        return s >= 0 && s <= 1;
      }),
      { numRuns: 500 },
    );
  });

  it('Property 5: short-text empty – fewer tokens than k yields []', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }).filter(s => !/\s/.test(s)), {
          minLength: 0,
          maxLength: 7,
        }),
        (k, w, tokens) => {
          if (tokens.length >= k) return true; // skip: not the short case
          const fp = kgramWinnow(tokens.join(' '), { kgramSize: k, windowSize: w });
          return fp.length === 0;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('Property 6: sorted – result array is always sorted ascending', () => {
    fc.assert(
      fc.property(textArb, cfgArb, (text, c) => {
        const fp = kgramWinnow(text, c);
        for (let i = 1; i < fp.length; i++) {
          if ((fp[i] as number) < (fp[i - 1] as number)) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
