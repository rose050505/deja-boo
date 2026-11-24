/** Property tests for the pure functions added in post-review fixes 4 (graveyard-miner and revenant-watch tasks.md). */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { commentSyntax, normalizeBlock, renameIdentifiers } from './normalize.js';
import { containedIn, fingerprintLines, kgramSetOfLines, matchWindowed } from './match.js';
import { sortedDistinct, winnowHashes } from './fingerprint.js';
import { findRevenants, idFingerprintOf, matchWindowedIndexed, scoreTombstone, TextIndex, RENAME_PENALTY } from './watch.js';
import type { WindowIndex } from './watch.js';
import { DEFAULT_MINER_CONFIG, type Graveyard, type Tombstone } from './types.js';

const word = fc.stringMatching(/^[a-z]{5,9}$/);
const codeLine = fc.tuple(word, word, word, fc.integer({ min: 0, max: 999 })).map(([a, b, c, n]) => `  const ${a} = ${b}(${c}, ${n}, opts.${b});`);
const block = fc.array(codeLine, { minLength: 8, maxLength: 14 });
const anyLine = fc.oneof(codeLine, word.map(w => `# ${w}`), word.map(w => `/* ${w}`), word.map(w => `${w} */`), word.map(w => `x = '${w}/**' # ${w}`), fc.constant(''));
const LANGS = ['python', 'yaml', 'typescript', 'javascript', 'shell', 'unknown', 'markdown', undefined];

function stone(lines: string[], language = 'typescript', over: Partial<Tombstone> = {}): Tombstone {
  return {
    id: 'f'.repeat(40), fingerprint: fingerprintLines(lines, { ...DEFAULT_MINER_CONFIG, language }), lines, path: 'a.ts', language,
    buriedAt: '2026-03-02T00:00:00Z', buriedAtTimestamp: 0, commit: 'c'.repeat(40), author: 'x@y',
    causeOfDeath: 'Revert "x"', links: [], revivals: [], deaths: [], ...over,
  };
}

describe('per-language comment syntax (normalizeBlock)', () => {
  it('unit: a glob in a YAML string is not a comment opener (flask .github/workflows/tests.yaml)', () => {
    const yaml = ["paths-ignore:", "  - 'docs/**'", "  - '*.md'", 'jobs:', '  tests:', '    runs-on: ubuntu-latest  # pinned'];
    expect(normalizeBlock(yaml, { renameIds: false, language: 'yaml' })).toBe("paths-ignore:\n- 'docs/**'\n- '*.md'\njobs:\ntests:\nruns-on: ubuntu-latest");
  });
  it('unit: Python keeps floor division; JavaScript keeps `#` in private fields; C-like strips `//` and `/* */`', () => {
    expect(normalizeBlock(['x = a // b  # half'], { renameIds: false, language: 'python' })).toBe('x = a // b');
    expect(normalizeBlock(['this.#count = 1; // note'], { renameIds: false, language: 'javascript' })).toBe('this.#count = 1;');
    expect(normalizeBlock(['a(); /* gone */ b();'], { renameIds: false, language: 'typescript' })).toBe('a(); b();');
    expect(normalizeBlock(['s = "/* not a comment */"'], { renameIds: false, language: 'typescript' })).toBe('s = "/* not a comment */"');
  });
  it('property: in a `#` language no line loses text before its first unquoted `#`; quoted `/*` never hides text', () => {
    fc.assert(fc.property(fc.array(anyLine, { maxLength: 20 }), fc.constantFrom('python', 'yaml', 'shell'), (lines, language) => {
      const out = normalizeBlock(lines, { renameIds: false, language });
      for (const l of lines) {
        const code = l.startsWith('#') ? '' : l.split(' # ')[0]!.trim().replace(/\s+/g, ' ');
        if (code !== '' && !code.startsWith('#')) expect(out.split('\n')).toContain(code);
      }
    }), { numRuns: 200 });
  });
  it('property: commentSyntax is total and the same for an unknown or undefined language', () => {
    fc.assert(fc.property(fc.string(), s => {
      const syn = commentSyntax(s);
      expect(Array.isArray(syn.line) && Array.isArray(syn.block)).toBe(true);
    }));
    expect(commentSyntax('no-such-language')).toEqual(commentSyntax(undefined));
  });
  it('property: renameIdentifiers is idempotent and normalizeBlock with renameIds equals renaming each normalized line', () => {
    fc.assert(fc.property(fc.array(anyLine, { maxLength: 15 }), fc.constantFrom(...LANGS), (lines, language) => {
      const plain = normalizeBlock(lines, { renameIds: false, language });
      const renamed = normalizeBlock(lines, { renameIds: true, language });
      expect(renamed).toBe(plain.split('\n').map(renameIdentifiers).join('\n'));
      expect(renamed.split('\n').map(renameIdentifiers).join('\n')).toBe(renamed);
    }), { numRuns: 200 });
  });
});

describe('containment helpers', () => {
  it('property: kgramSetOfLines contains every hash of fingerprintLines; containedIn is in [0, 1] and 1 for a block embedded in a larger text', () => {
    fc.assert(fc.property(block, fc.array(codeLine, { maxLength: 10 }), fc.array(codeLine, { maxLength: 10 }), fc.constantFrom(...LANGS), (b, pre, post, language) => {
      const fp = fingerprintLines(b, { ...DEFAULT_MINER_CONFIG, language });
      const own = kgramSetOfLines(b, { ...DEFAULT_MINER_CONFIG, language });
      for (const h of fp) expect(own.has(h)).toBe(true);
      const c = containedIn(fp, kgramSetOfLines([...pre, ...b, ...post], { ...DEFAULT_MINER_CONFIG, language }));
      expect(c).toBe(1);
      const other = containedIn(fp, kgramSetOfLines(pre, { ...DEFAULT_MINER_CONFIG, language }));
      expect(other).toBeGreaterThanOrEqual(0);
      expect(other).toBeLessThanOrEqual(1);
    }), { numRuns: 100 });
    expect(containedIn([], new Set([1]))).toBe(0);
  });
  it('property: sortedDistinct equals Set + sort; winnowHashes picks the minimum of every window', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 60 }), fc.integer({ min: 1, max: 6 }), (xs, w) => {
      expect(sortedDistinct(Uint32Array.from(xs))).toEqual([...new Set(xs)].sort((a, b) => a - b));
      const expected = new Set<number>();
      if (xs.length > 0 && xs.length < w) expected.add(Math.min(...xs));
      for (let i = 0; i + w <= xs.length; i++) expected.add(Math.min(...xs.slice(i, i + w)));
      expect(winnowHashes(xs, 0, xs.length, w)).toEqual([...expected].sort((a, b) => a - b));
    }), { numRuns: 300 });
  });
});

describe('windows with language and renamed identifiers', () => {
  it('property: matchWindowedIndexed equals matchWindowed for every language, with and without renaming', () => {
    fc.assert(fc.property(fc.array(anyLine, { minLength: 1, maxLength: 12 }), fc.array(anyLine, { maxLength: 25 }), fc.constantFrom(...LANGS), fc.boolean(), (tl, cand, language, renameIds) => {
      const cfg = { ...DEFAULT_MINER_CONFIG, language, renameIds };
      const t = { lines: tl, fingerprint: fingerprintLines(tl, cfg) };
      const cache = new Map<number, WindowIndex>();
      expect(matchWindowedIndexed(t, cand, cache, 0, { language, renameIds })).toEqual(matchWindowed(t, cand, cfg));
    }), { numRuns: 300 });
  });
});

describe('scoreTombstone (raw + identifier-renamed score)', () => {
  const rename = (lines: string[], ids: string[]): string[] => ids.reduce((ls, id, i) => ls.map(l => l.replace(new RegExp(`\\b${id}\\b`, 'g'), `renamed${i}x`)), lines);

  it('property: never below the raw windowed score at or above warn, and equal to it with the renamed score off', () => {
    fc.assert(fc.property(block, fc.array(codeLine, { maxLength: 20 }), (b, cand) => {
      const t = stone(b);
      const text = new TextIndex([...cand, ...b.slice(2)]);
      const raw = matchWindowed(t, text.lines, { ...DEFAULT_MINER_CONFIG, language: 'typescript' }).similarity;
      const s = scoreTombstone(t, text, 0.5);
      if (raw >= 0.5) expect(s.similarity).toBeGreaterThanOrEqual(raw - 1e-12);
      const off = scoreTombstone(t, text, 0.5, 4, { penalty: Infinity, rawFloor: 2 });
      if (raw >= 0.5) expect(off.similarity).toBeCloseTo(raw, 12);
      expect(off.renamed).toBe(false);
      expect(s.similarity).toBeLessThanOrEqual(1);
    }), { numRuns: 150 });
  });

  it('property: a text containing the tombstone lines scores 1, raw', () => {
    fc.assert(fc.property(block, fc.array(codeLine, { maxLength: 10 }), (b, pre) => {
      const s = scoreTombstone(stone(b), new TextIndex([...pre, ...b]), 0.5);
      expect(s.similarity).toBe(1);
      expect(s.renamed).toBe(false);
    }), { numRuns: 100 });
  });

  it('property: renaming 2-4 identifiers keeps the score at warn or above, and a renamed-only hit is warn, never block', () => {
    fc.assert(fc.property(block, fc.integer({ min: 2, max: 4 }), (b, n) => {
      const ids = [...new Set(b.flatMap(l => [...l.matchAll(/const ([a-z]+) = ([a-z]+)/g)].flatMap(m => [m[1]!, m[2]!])))].slice(0, n);
      const t = stone(b, 'typescript', { links: [{ type: 'pr', ref: '1' }] });
      const rewritten = rename(b, ids);
      const s = scoreTombstone(t, new TextIndex(rewritten), 0.5);
      expect(s.similarity).toBeGreaterThanOrEqual(0.5);
      const hits = findRevenants({ tombstones: [t], stats: {} } as unknown as Graveyard, rewritten, { warn: 0.5, block: 0.7 });
      for (const h of hits) if (h.renamed) expect(h.level).toBe('warn');
    }), { numRuns: 100 });
  });

  it('property: unrelated code never scores at warn through the renamed score', () => {
    fc.assert(fc.property(block, block, (a, b) => {
      const s = scoreTombstone(stone(a), new TextIndex(b), 0.5);
      expect(s.similarity).toBeLessThan(0.5);
    }), { numRuns: 100 });
  });

  it('unit: idFingerprintOf uses the stored idFingerprint, else computes it from lines in the tombstone language', () => {
    const lines = ['def f(a, b):', '    return a // b  # floor', '    pass', 'x = f(1, 2)'];
    const t = stone(lines, 'python');
    expect(idFingerprintOf(t)).toEqual(fingerprintLines(lines, { ...DEFAULT_MINER_CONFIG, renameIds: true, language: 'python' }));
    expect(idFingerprintOf({ ...t, idFingerprint: [7] })).toEqual([7]);
    expect(RENAME_PENALTY).toBeGreaterThan(0);
  });
});
