import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { extractBlocks } from './block-extract.js';
import type { Hunk } from '../core/types.js';

function makeHunk(deletedLines: string[], addedLines: string[] = []): Hunk {
  return {
    filePath: 'src/example.ts',
    oldStart: 10,
    newStart: 10,
    deletedLines,
    addedLines,
  };
}

describe('extractBlocks – unit', () => {
  it('a run of 6 non-blank deleted lines produces one block', () => {
    const hunk = makeHunk(['a', 'b', 'c', 'd', 'e', 'f']);
    const blocks = extractBlocks(hunk, 'deleted', 4);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines).toHaveLength(6);
  });

  it('a run of 3 lines (below default minimum of 4) produces no block', () => {
    const hunk = makeHunk(['a', 'b', 'c']);
    expect(extractBlocks(hunk, 'deleted', 4)).toHaveLength(0);
  });

  it('a hunk with only blank deleted lines produces no block', () => {
    const hunk = makeHunk(['  ', '\t', '']);
    expect(extractBlocks(hunk, 'deleted', 4)).toHaveLength(0);
  });

  it('a blank line in the middle of a run does not break it and is not in block.lines', () => {
    const hunk = makeHunk(['a', 'b', '', 'c', 'd', 'e']);
    const blocks = extractBlocks(hunk, 'deleted', 4);
    // 5 non-blank lines ≥ 4, so one block
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines).not.toContain('');
    expect(blocks[0]!.lines).toHaveLength(5);
  });

  it('a blank line at the start of a run is skipped; block still forms if enough non-blank lines follow', () => {
    const hunk = makeHunk(['', '  ', 'x', 'y', 'z', 'w']);
    const blocks = extractBlocks(hunk, 'deleted', 4);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines).toHaveLength(4);
    expect(blocks[0]!.lines[0]).toBe('x');
  });

  it('two separate hunks each produce their own block (simulates two runs separated by context)', () => {
    // The diff parser splits on context lines, so each contiguous run becomes a Hunk.
    const h1 = makeHunk(['a', 'b', 'c', 'd']);
    const h2 = makeHunk(['e', 'f', 'g', 'h']);
    const blocks1 = extractBlocks(h1, 'deleted', 4);
    const blocks2 = extractBlocks(h2, 'deleted', 4);
    expect(blocks1).toHaveLength(1);
    expect(blocks2).toHaveLength(1);
    expect(blocks1[0]!.lines).toEqual(['a', 'b', 'c', 'd']);
    expect(blocks2[0]!.lines).toEqual(['e', 'f', 'g', 'h']);
  });

  it('extractBlocks works on added side', () => {
    const hunk = makeHunk([], ['x', 'y', 'z', 'w']);
    const blocks = extractBlocks(hunk, 'added', 4);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines).toEqual(['x', 'y', 'z', 'w']);
    expect(blocks[0]!.hunkStart).toBe(hunk.newStart);
  });

  it('hunkStart is oldStart for deleted side, newStart for added side', () => {
    const hunk: Hunk = {
      filePath: 'f.ts',
      oldStart: 5,
      newStart: 7,
      deletedLines: ['a', 'b', 'c', 'd'],
      addedLines: ['e', 'f', 'g', 'h'],
    };
    expect(extractBlocks(hunk, 'deleted', 4)[0]!.hunkStart).toBe(5);
    expect(extractBlocks(hunk, 'added', 4)[0]!.hunkStart).toBe(7);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('extractBlocks – property tests', () => {
  const nonBlankLine = fc.string({ minLength: 1 }).filter(s => s.trim().length > 0);
  const anyLine = fc.oneof(nonBlankLine, fc.constant(''), fc.constant('   '));

  it('Property 1: coverage – every line in a returned block appears in the original hunk lines', () => {
    fc.assert(
      fc.property(
        fc.array(anyLine, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 1, max: 8 }),
        (lines, minLines) => {
          const hunk = makeHunk(lines);
          const blocks = extractBlocks(hunk, 'deleted', minLines);
          for (const block of blocks) {
            for (const bLine of block.lines) {
              if (!lines.includes(bLine)) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 2: minimum length – every returned block has lines.length >= minLines', () => {
    fc.assert(
      fc.property(
        fc.array(anyLine, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 1, max: 8 }),
        (lines, minLines) => {
          const hunk = makeHunk(lines);
          const blocks = extractBlocks(hunk, 'deleted', minLines);
          return blocks.every(b => b.lines.length >= minLines);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 3: no blanks in output – no line in block.lines is empty or whitespace-only', () => {
    fc.assert(
      fc.property(
        fc.array(anyLine, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 1, max: 8 }),
        (lines, minLines) => {
          const hunk = makeHunk(lines);
          const blocks = extractBlocks(hunk, 'deleted', minLines);
          return blocks.every(b => b.lines.every(l => l.trim().length > 0));
        },
      ),
      { numRuns: 300 },
    );
  });
});
