import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterMoved } from './move-filter.js';
import type { RawBlock, MinerConfig } from '../core/types.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import { kgramSetOfLines } from '../core/match.js';

const DEFAULT_CFG = {
  renameIds: false,
  kgramSize: 3,   // small k so short blocks get fingerprinted
  windowSize: 2,
  aliveAfterDeath: 0.9,
} satisfies Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize' | 'aliveAfterDeath'>;

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
  it('a block moved into a larger added block is excluded (containment, not Jaccard; requests ef8563ab)', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    const big = block(['const before = 1;', 'let other = compute(before);', ...CODE_BLOCK, 'export default fetchUser;', 'module.exports.x = other;'], 'src/b.ts');
    expect(filterMoved([del], [big], DEFAULT_CFG)).toHaveLength(0);
  });

  it('a block re-wrapped into fewer lines is excluded even when the replacement is shorter than minBlockLines (httpie 05db75bd)', () => {
    const del = block(['result = call(', '    alpha,', '    beta,', '    gamma)'], 'x.py');
    const add = block(['result = call(alpha, beta, gamma)'], 'x.py');
    expect(filterMoved([del], [add], { ...DEFAULT_MINER_CONFIG, kgramSize: 3, windowSize: 2 })).toHaveLength(0);
  });

  it('a block still present in the post-commit content of a touched file is excluded', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    const post = kgramSetOfLines(['// header', ...CODE_BLOCK, 'more();'], { ...DEFAULT_CFG, language: 'typescript' });
    expect(filterMoved([del], [], DEFAULT_CFG, post)).toHaveLength(0);
    expect(filterMoved([del], [], DEFAULT_CFG, new Set())).toHaveLength(1);
  });

  it('a block whose replacement changes one flag survives at the default 0.97 (express de129c28)', () => {
    const lines = [
      '"test": "mocha --require test/support/env --reporter spec --bail --check-leaks test/ test/acceptance/",',
      '"test-ci": "istanbul cover node_modules/mocha/bin/_mocha --report lcovonly -- --require test/support/env --reporter spec --check-leaks test/ test/acceptance/",',
      '"test-cov": "istanbul cover node_modules/mocha/bin/_mocha -- --require test/support/env --reporter dot --check-leaks test/ test/acceptance/",',
      '"test-tap": "mocha --require test/support/env --reporter tap --check-leaks test/ test/acceptance/"',
    ];
    const edited = lines.map(l => l.replace('--check-leaks', '--check-leaks --no-exit'));
    expect(filterMoved([block(lines, 'package.json')], [block(edited, 'package.json')], DEFAULT_MINER_CONFIG)).toHaveLength(1);
  });

  it('block deleted in A and added verbatim in B is excluded (move)', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    const add = block(CODE_BLOCK, 'src/b.ts');
    expect(filterMoved([del], [add], DEFAULT_CFG)).toHaveLength(0);
  });

  it('block deleted with no corresponding addition survives', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    expect(filterMoved([del], [], DEFAULT_CFG)).toHaveLength(1);
  });

  it('re-indented block (same code, different leading spaces) is excluded when containment >= threshold', () => {
    const del = block(CODE_BLOCK, 'src/a.ts');
    const addedWithIndent = block(CODE_BLOCK.map(l => `  ${l}`), 'src/b.ts');
    // After normalization, leading whitespace is stripped → same content → Jaccard = 1
    expect(filterMoved([del], [addedWithIndent], DEFAULT_CFG)).toHaveLength(0);
  });

  it('a lightly edited block survives at threshold 1.0', () => {
    // Nearly identical: change only the last line to something genuinely different.
    // We use a completely different last line so the fingerprints differ at moveThreshold=1.0.
    const addedSimilar = block([CODE_BLOCK[0] as string, '  const link = makeLink(user);', ...CODE_BLOCK.slice(2)], 'src/b.ts');
    // At strict threshold (1.0), not-exact should survive
    const cfgStrict = { ...DEFAULT_CFG, aliveAfterDeath: 1.0 };
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

  it('with aliveAfterDeath: 1.0, only exact fingerprint matches are excluded', () => {
    const del = block(CODE_BLOCK);
    // The changed block has a genuinely different last line (not just a comment, since
    // comments are stripped by normalizeBlock and would make it identical).
    const addedSlightlyDiff = block([CODE_BLOCK[0] as string, '  const link = makeLink(user);', ...CODE_BLOCK.slice(2)], 'src/b.ts');
    const cfgExact = { ...DEFAULT_CFG, aliveAfterDeath: 1.0 };
    // Slightly different → containment < 1.0 → should survive
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
        const result = filterMoved([del], [add], { ...DEFAULT_CFG, aliveAfterDeath: 0.5 });
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
