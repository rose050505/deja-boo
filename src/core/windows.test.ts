import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fnv1a32, kgramHashAt, kgramWinnow, winnowHashes } from './fingerprint.js';
import { fingerprintLines, matchWindowed } from './match.js';
import { matchWindowedIndexed, type WindowIndex } from './watch.js';
import { CandidateWindows } from './windows.js';
import { normalizeBlock, normalizeLineFrom, type CommentState } from './normalize.js';
import { tokenize } from './tokenize.js';

const word = fc.stringMatching(/^[a-z]{3,6}$/);
/** Lines with every comment opener and closer, so windows start inside comments and open new ones. */
const lineArb = fc.oneof(
  word.map(w => `  call_${w}(${w}, 1, opts.${w});`),
  word.map(w => `/* ${w} ${w}`),
  word.map(w => `${w} */ ${w}(1, 2);`),
  word.map(w => `<!-- ${w}`),
  word.map(w => `${w} --> x = ${w};`),
  word.map(w => `{- ${w}`),
  word.map(w => `${w} -} y = ${w};`),
  word.map(w => `/* ${w} */ z = ${w}(2);`),
  word.map(w => `// ${w} /* ${w}`),
  word.map(w => `s = "/* ${w}"; t = ${w};`),
  word.map(w => ` * ${w}`),
  fc.constant(''),
);
const linesArb = fc.array(lineArb, { minLength: 0, maxLength: 60 });

describe('windowing from precomputed k-gram hashes', () => {
  it('property: kgramHashAt equals fnv1a32 of the joined k-gram', () => {
    fc.assert(fc.property(fc.string(), fc.integer({ min: 1, max: 6 }), (text, k) => {
      const tokens = tokenize(text);
      for (let i = 0; i + k <= tokens.length; i++) expect(kgramHashAt(tokens, i, k)).toBe(fnv1a32(tokens.slice(i, i + k).join(' ')));
    }));
  });

  it('property: winnowHashes over the whole range equals kgramWinnow', () => {
    fc.assert(fc.property(fc.array(fc.nat(2 ** 32 - 1), { maxLength: 30 }), fc.integer({ min: 1, max: 6 }), (hashes, w) => {
      const tokens = hashes.map(String);
      const ref = kgramWinnow(tokens.join(' '), { kgramSize: 1, windowSize: w });
      const own = winnowHashes(tokens.map(t => fnv1a32(t)), 0, tokens.length, w);
      expect(own).toEqual(ref);
    }));
  });

  it('property: line-by-line normalization chained from "normal" equals normalizeBlock', () => {
    fc.assert(fc.property(linesArb, lines => {
      let q: CommentState = 'normal';
      const out: string[] = [];
      for (const l of lines) {
        const r = normalizeLineFrom(l, q);
        q = r.state;
        if (r.text !== '') out.push(r.text);
      }
      expect(out.join('\n')).toBe(normalizeBlock(lines, { renameIds: false }));
    }), { numRuns: 300 });
  });

  it('property: every window fingerprint equals fingerprintLines of that window', () => {
    fc.assert(fc.property(linesArb, fc.integer({ min: 1, max: 12 }), (lines, width) => {
      const cw = new CandidateWindows(lines);
      const index: WindowIndex = { fps: new Map() };
      for (let s = 0; s + width <= lines.length; s++) expect(cw.fingerprint(s, width, index)).toEqual(fingerprintLines(lines.slice(s, s + width)));
    }), { numRuns: 300 });
  });

  it('property: new windowing equals old windowing (matchWindowed) on random inputs with comments', () => {
    fc.assert(fc.property(linesArb, linesArb, linesArb, (tl, pre, post) => {
      const t = { lines: tl, fingerprint: fingerprintLines(tl) };
      for (const candidate of [[...pre, ...tl, ...post], [...pre, ...post], tl]) {
        expect(matchWindowedIndexed(t, candidate, new Map())).toEqual(matchWindowed(t, candidate));
      }
    }), { numRuns: 300 });
  });

  it('property: a tombstone cut from the middle of the candidate scores the same through both paths', () => {
    fc.assert(fc.property(linesArb, fc.nat(), fc.nat(), (cand, a, b) => {
      if (cand.length === 0) return;
      const from = a % cand.length;
      const tl = cand.slice(from, from + 1 + (b % 15));
      const t = { lines: tl, fingerprint: fingerprintLines(tl) };
      expect(matchWindowedIndexed(t, cand, new Map())).toEqual(matchWindowed(t, cand));
    }), { numRuns: 300 });
  });

  it('property: with a similarity floor the match is unchanged at or above the floor and stays below it otherwise', () => {
    fc.assert(fc.property(linesArb, fc.nat(), fc.nat(), fc.double({ min: 0.05, max: 1, noNaN: true }), (cand, a, b, floor) => {
      if (cand.length === 0) return;
      const from = a % cand.length;
      const tl = cand.slice(from, from + 1 + (b % 15));
      const t = { lines: tl, fingerprint: fingerprintLines(tl) };
      const ref = matchWindowed(t, cand);
      const got = matchWindowedIndexed(t, cand, new Map(), floor);
      if (ref.similarity >= floor) expect(got).toEqual(ref);
      else expect(got.similarity).toBeLessThan(floor);
    }), { numRuns: 300 });
  });
});
