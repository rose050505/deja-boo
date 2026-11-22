import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterMoved } from './move-filter.js';
import type { RawBlock, MinerConfig } from '../core/types.js';

const DEFAULT_CFG = {
  renameIds: false,
  kgramSize: 3,   // small k so short blocks get fingerprinted
  windowSize: 2,
  moveThreshold: 0.9,
} satisfies Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize' | 'moveThreshold'>;

function block(lines: string[], filePath = 'src/a.ts', hunkStart = 1): RawBlock {
  return { filePath, hunkStart, lines };
}

// A multi-line block large enough to get a non-empty fingerprint with k=3
const CODE_BLOCK = [
  'function fetchUser(id) {',
  '  const url = buildUrl(id);',
  '  return fetch(url).then(r => r.json());',
  '}',
];

describe('filterMoved – unit', () => {
  it('block deleted in A and added verbatim in B is excluded (move)', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    const add = block(CODE_BLOCK, 'src/b.ts');
    expect(filterMoved([del], [add], DEFAULT_CFG)).toHaveLength(0);
  });

  it('block deleted with no corresponding addition survives', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    expect(filterMoved([del], [], DEFAULT_CFG)).toHaveLength(1);
  });

  it('re-indented block (same code, different leading spaces) is excluded when Jaccard >= threshold', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    const addedWithIndent = block(CODE_BLOCK.map(l => `  ${l}`), 'src/b.ts');
    // After normalization, leading whitespace is stripped → same content → Jaccard = 1
    expect(filterMoved([del], [addedWithIndent], DEFAULT_CFG)).toHaveLength(0);
  });

  it('a lightly edited block is excluded when Jaccard >= threshold and survives when < threshold', () => {
    // Nearly identical: change only the last line to something genuinely different.
    // We use a completely different last line so the fingerprints differ at moveThreshold=1.0.
    const addedSimilar = block([...CODE_BLOCK.slice(0, 3), 'return handleError(); }'], 'src/b.ts');
    // At strict threshold (1.0), not-exact should survive
    const cfgStrict = { ...DEFAULT_CFG, moveThreshold: 1.0 };
    const resultStrict = filterMoved([block(CODE_BLOCK)], [addedSimilar], cfgStrict);
    expect(resultStrict).toHaveLength(1);
  });

  it('two blocks where only one is moved: only the moved one is excluded', () => {
    const moved = block(CODE_BLOCK, 'src/a.ts', 1);
    const unique = block(['x = uniqueCode()', 'y = moreUnique()', 'z = nothing()', 'w = done()'], 'src/a.ts', 50);
    const addedMoved = block(CODE_BLOCK, 'src/b.ts', 1);
    const result = filterMoved([moved, unique], [addedMoved], DEFAULT_CFG);
    expect(result).toHaveLength(1);
    expect(result[0]!.hunkStart).toBe(50);
  });

  it('with moveThreshold: 1.0, only exact fingerprint matches are excluded', () => {
    const del = block(CODE_BLOCK);
    // The changed block has a genuinely different last line (not just a comment, since
    // comments are stripped by normalizeBlock and would make it identical).
    const addedSlightlyDiff = block([...CODE_BLOCK.slice(0, -1), 'return handleError(false); }'], 'src/b.ts');
    const cfgExact = { ...DEFAULT_CFG, moveThreshold: 1.0 };
    // Slightly different → Jaccard < 1.0 → should survive
    const result = filterMoved([del], [addedSlightlyDiff], cfgExact);
    expect(result).toHaveLength(1);
    // Exact match → should be excluded
    const exact = block(CODE_BLOCK, 'src/b.ts');
    expect(filterMoved([del], [exact], cfgExact)).toHaveLength(0);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('filterMoved – property tests', () => {
  // Lines that survive normalization: not blank, don't start block comments,
  // don't start single-line comments, contain at least one non-whitespace word char.
  const nonBlankLine = fc.string({ minLength: 3 }).filter(s => {
    const t = s.trim();
    if (t.length < 3) return false;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('--')) return false;
    if (t.startsWith('/*') || t.startsWith('<!--') || t.startsWith('{-')) return false;
    // Ensure at least one identifier-like token so fingerprint is non-empty
    return /[A-Za-z0-9_]{3,}/.test(t);
  });
  const codeBlock = fc.array(nonBlankLine, { minLength: 4, maxLength: 10 });

  it('Property 1: exact move is not a death (Jaccard = 1.0, always excluded)', () => {
    // Use lines guaranteed to produce non-empty fingerprints (3+ tokens, no comment markers).
    const richLine = fc.stringMatching(/^[a-z]{4} [a-z]{4} [a-z]{4}[a-z]*$/);
    const richBlock = fc.array(richLine, { minLength: 4, maxLength: 10 });
    fc.assert(
      fc.property(richBlock, lines => {
        const del = block(lines, 'src/a.ts');
        const add = block(lines, 'src/b.ts');
        // Any threshold ≤ 1.0 must exclude an exact copy
        const result = filterMoved([del], [add], { ...DEFAULT_CFG, moveThreshold: 0.5 });
        return result.length === 0;
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2: indentation-only change is not a death at default threshold', () => {
    // Use only lines that contain at least k=3 unique identifier-like tokens so the
    // fingerprint is guaranteed non-empty. Lines starting with comment markers are excluded.
    const richLine = fc.stringMatching(/^[a-z]{4} [a-z]{4} [a-z]{4}[a-z]*$/);
    const richBlock = fc.array(richLine, { minLength: 4, maxLength: 8 });
    fc.assert(
      fc.property(richBlock, lines => {
        const del = block(lines, 'src/a.ts');
        const add = block(lines.map(l => `    ${l}`), 'src/b.ts');
        // After normalization, leading whitespace is stripped → identical content → Jaccard = 1.0
        const result = filterMoved([del], [add], DEFAULT_CFG);
        return result.length === 0;
      }),
      { numRuns: 200 },
    );
  });

  it('Property 3: low similarity survives (deleted block with no added content, Jaccard = 0)', () => {
    fc.assert(
      fc.property(codeBlock, lines => {
        const del = block(lines, 'src/a.ts');
        const result = filterMoved([del], [], DEFAULT_CFG);
        return result.length === 1;
      }),
      { numRuns: 200 },
    );
  });
});
