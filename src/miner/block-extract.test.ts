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

describe('extractBlocks – comment fragments (post-review fixes 3)', () => {
  const jsdoc = [' * Return request header.', ' *', ' * @return {Object}', ' * @api public'];

  it('unit: a deleted JSDoc interior without its opener is not a block', () => {
    expect(extractBlocks(makeHunk(jsdoc), 'deleted', 4)).toEqual([]);
    expect(extractBlocks(makeHunk(['/**', ...jsdoc, ' */']), 'deleted', 4)).toEqual([]);
  });

  it('unit: comment lines count nowhere near code, and the added side is left alone', () => {
    expect(extractBlocks(makeHunk([], jsdoc), 'added', 4)).toHaveLength(1);
    expect(extractBlocks(makeHunk([...jsdoc, 'return this.header;']), 'deleted', 4)).toHaveLength(1);
  });

  it('unit: a hunk that starts inside a block comment loses the comment lines up to its closer', () => {
    const hunk: Hunk = { ...makeHunk([' * tail of a comment', ' * more', ' */', 'a();', 'b();', 'c();', 'd();']), startsInComment: true };
    expect(extractBlocks(hunk, 'deleted', 4)[0]!.lines).toEqual(['a();', 'b();', 'c();', 'd();']);
    expect(extractBlocks({ ...hunk, deletedLines: ['a();', 'b();', 'c();', 'd();', 'e();'] }, 'deleted', 4)).toEqual([]); // no closer: all comment
  });

  it('property: a block made only of comment lines never becomes a tombstone block', () => {
    const commentLine = fc.oneof(
      fc.string().map(s => ` * ${s}`), fc.string().map(s => `// ${s}`), fc.string().map(s => `/* ${s}`),
      fc.string().map(s => `# ${s}`), fc.constantFrom('', '  ', ' *', ' */', '#'),
    ).filter(l => !l.includes('\n'));
    fc.assert(fc.property(fc.array(commentLine, { maxLength: 30 }), lines => extractBlocks(makeHunk(lines), 'deleted', 1).length === 0));
  });
});
