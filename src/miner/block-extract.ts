import type { Hunk, RawBlock } from '../core/types.js';

/**
 * Extract a RawBlock from one side of a hunk.
 *
 * The diff parser emits one Hunk per contiguous run of changed lines (it splits on
 * context lines), so each hunk side already represents a single run.  Blank lines
 * within the run are skipped (not counted, not included in block.lines) but do NOT
 * end the run.
 *
 * Returns an array of zero or one RawBlock: zero if the non-blank line count
 * is below minLines, one otherwise.
 *
 * Invariants:
 *   - Every returned block has lines.length >= minLines.
 *   - No line in block.lines is empty or whitespace-only.
 *   - Every line in block.lines appears in hunk.deletedLines / hunk.addedLines.
 */
export function extractBlocks(
  hunk: Hunk,
  side: 'deleted' | 'added',
  minLines: number,
): RawBlock[] {
  const sourceLines = side === 'deleted' ? hunk.deletedLines : hunk.addedLines;
  const hunkStart = side === 'deleted' ? hunk.oldStart : hunk.newStart;

  // Filter out blank lines; blanks do not end the run per REQ-3.
  const nonBlank = sourceLines.filter(l => l.trim().length > 0);

  if (nonBlank.length < minLines) return [];

  return [{ filePath: hunk.filePath, hunkStart, lines: nonBlank }];
}
