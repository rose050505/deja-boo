/** Property tests for the latency work after post-review fixes 5: exact window sizes, candidate bounds and the lazy renamed pass of scoreTombstone. */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fingerprintLines, kgramSetOfLines } from './match.js';
import { similarity } from './match.js';
import { containment } from './match.js';
import { scoreTombstone, TextIndex, RENAME_PENALTY, RENAME_RAW_FLOOR } from './watch.js';
import { CandidateWindows, sharedNeeded } from './windows.js';
import type { WindowIndex } from './windows.js';
import { DEFAULT_MINER_CONFIG, type Tombstone } from './types.js';
import { normalizeBlock } from './normalize.js';
import { kgramHashSet } from './fingerprint.js';

const word = fc.stringMatching(/^[a-z]{4,8}$/);
const codeLine = fc.tuple(word, word, word, fc.integer({ min: 0, max: 99 })).map(([a, b, c, n]) => `  const ${a} = ${b}(${c}, ${n}, opts.${b});`);
const anyLine = fc.oneof(
  { arbitrary: codeLine, weight: 6 },
  word.map(w => `# ${w}`), word.map(w => `/* ${w}`), word.map(w => `${w} */ x = ${w}(1);`), word.map(w => `<!-- ${w}`), word.map(w => `${w} -->`), fc.constant(''),
);
/** Few distinct values, so picks repeat non-adjacently and the repeat bookkeeping is exercised. */
const repetitive = fc.array(fc.constantFrom('a = f(b, 1);', 'c = g(d, 2);', 'e = h(f, 3);', 'return a + c;'), { maxLength: 60 });

function stone(lines: string[]): Tombstone {
  return {
    id: 'f'.repeat(40), fingerprint: fingerprintLines(lines, { ...DEFAULT_MINER_CONFIG, language: 'typescript' }), lines, path: 'a.ts', language: 'typescript',
    buriedAt: '2026-03-02T00:00:00Z', buriedAtTimestamp: 0, commit: 'c'.repeat(40), author: 'x@y',
    causeOfDeath: 'x', links: [], revivals: [], deaths: [],
  };
}

describe('CandidateWindows.fingerprintSize', () => {
  it('property: equals the length of the window fingerprint whenever it is defined (comments, repeated code)', () => {
    fc.assert(fc.property(fc.oneof(fc.array(anyLine, { maxLength: 60 }), repetitive), fc.integer({ min: 1, max: 14 }), (lines, width) => {
      const cw = new CandidateWindows(lines);
      const index: WindowIndex = { fps: new Map() };
      for (let s = 0; s + width <= lines.length; s++) {
        const size = cw.fingerprintSize(s, width);
        if (size !== undefined) expect(size).toBe(cw.fingerprint(s, width, index).length);
      }
    }), { numRuns: 400 });
  });

  it('unit: defined for long plain windows', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `  const v${i} = call${i}(arg${i}, ${i}, opts.k${i});`);
    expect(new CandidateWindows(lines).fingerprintSize(3, 12)).toBeGreaterThan(0);
  });
});

describe('CandidateWindows.candidateBounds', () => {
  it('property: candidateStarts is its keys; a higher floor keeps exactly the windows whose count reaches it', () => {
    fc.assert(fc.property(fc.array(anyLine, { minLength: 1, maxLength: 50 }), fc.integer({ min: 1, max: 10 }), fc.double({ min: 0.1, max: 0.9, noNaN: true }), (lines, width, hi) => {
      const w = Math.min(width, lines.length);
      const cw = new CandidateWindows(lines);
      const fp = fingerprintLines(lines.slice(0, w));
      const index: WindowIndex = { fps: new Map() };
      const low = cw.candidateBounds(fp, w, index, 0.1);
      const high = cw.candidateBounds(fp, w, index, hi);
      expect([...cw.candidateStarts(fp, w, index, hi)]).toEqual([...high.keys()].sort((a, b) => a - b));
      const need = sharedNeeded(hi, fp.length);
      expect([...low].filter(([, c]) => c >= need).map(([s]) => s).sort((a, b) => a - b)).toEqual([...high.keys()].sort((a, b) => a - b));
    }), { numRuns: 200 });
  });
});

describe('plainGrams', () => {
  it('property: for a text without block-comment openers it is the k-gram set of the normalized text', () => {
    const plain = fc.array(fc.oneof(codeLine, word.map(w => `# ${w}`), word.map(w => `// ${w}`), fc.constant('')), { maxLength: 40 });
    fc.assert(fc.property(plain, fc.constantFrom('typescript', 'python', undefined), (lines, language) => {
      const got = new CandidateWindows(lines, { language }).plainGrams();
      expect(got).toEqual(kgramHashSet(normalizeBlock(lines, { ...DEFAULT_MINER_CONFIG, language }), DEFAULT_MINER_CONFIG.kgramSize));
      expect(kgramSetOfLines(lines, { ...DEFAULT_MINER_CONFIG, language })).toEqual(got);
    }), { numRuns: 200 });
  });
});

describe('scoreTombstone against the exhaustive definition', () => {
  /** Every window scored from scratch: raw Jaccard, then the renamed pass over windows with raw >= rawFloor, best raw first, as documented. */
  function reference(t: Tombstone, lines: string[], warn: number): { similarity: number; matchedLines: [number, number]; renamed: boolean } {
    const width = Math.min(t.lines.length, lines.length);
    const cfg = { ...DEFAULT_MINER_CONFIG, language: t.language };
    const idFp = fingerprintLines(t.lines, { ...cfg, renameIds: true });
    const wins = [];
    for (let s = 0; s + width <= lines.length; s++) {
      const slice = lines.slice(s, s + width);
      wins.push({ s, raw: similarity(t.fingerprint, fingerprintLines(slice, cfg)), ren: similarity(idFp, fingerprintLines(slice, { ...cfg, renameIds: true })), slice });
    }
    let best = { similarity: 0, matchedLines: [0, 0] as [number, number], renamed: false };
    for (const w of wins) if (w.raw > best.similarity) best = { similarity: w.raw, matchedLines: [w.s + 1, w.s + width], renamed: false };
    if (best.similarity >= 1 - RENAME_PENALTY || idFp.length < 4) return best;
    const ranked = wins.filter(w => w.raw >= RENAME_RAW_FLOOR).sort((x, y) => y.raw - x.raw || x.s - y.s);
    for (const w of ranked) {
      const adjusted = w.ren - RENAME_PENALTY;
      if (adjusted > best.similarity) best = { similarity: adjusted, matchedLines: [w.s + 1, w.s + width], renamed: true };
      if (best.similarity >= 1 - RENAME_PENALTY - 1e-9) break;
    }
    return best;
  }

  const rename = (lines: string[], k: number): string[] => lines.map(l => l.replace(/const [a-z]+/, `const renamed${k}`).replace(/opts/g, 'o'));

  it('property: at or above warn the score, window and flag equal the exhaustive ones; below warn it stays below', () => {
    const block = fc.array(codeLine, { minLength: 5, maxLength: 12 });
    fc.assert(fc.property(block, fc.array(anyLine, { maxLength: 25 }), fc.array(anyLine, { maxLength: 25 }), fc.integer({ min: 0, max: 3 }), fc.constantFrom(0.4, 0.5, 0.6), (b, pre, post, mode, warn) => {
      const t = stone(b);
      const body = mode === 0 ? b : mode === 1 ? rename(b, 1) : mode === 2 ? rename(b.slice(1), 2) : [...b.slice(0, 3), 'x = 1;', ...b.slice(4)];
      const lines = [...pre, ...body, ...post];
      if (lines.length === 0) return;
      const ref = reference(t, lines, warn);
      const got = scoreTombstone(t, new TextIndex(lines), warn);
      if (ref.similarity >= warn) {
        expect(got.similarity).toBeCloseTo(ref.similarity, 12);
        expect(got.matchedLines).toEqual(ref.matchedLines);
        expect(got.renamed).toBe(ref.renamed);
        expect(got.containment).toBeGreaterThanOrEqual(0);
        expect(containment(t.fingerprint, fingerprintLines(lines.slice(got.matchedLines[0] - 1, got.matchedLines[1]), { ...DEFAULT_MINER_CONFIG, language: 'typescript' }))).toBeCloseTo(got.containment, 12);
      } else {
        expect(got.similarity).toBeLessThan(warn);
      }
    }), { numRuns: 400 });
  });
});
