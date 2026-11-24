import type { Hunk, RawBlock } from '../core/types.js';
import { isCommentLine } from '../core/comment.js';

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
 * On the deleted side, a hunk that starts inside a block comment loses the lines up to the one that closes it, and a block whose
 * lines are all comment-like (isCommentLine) is dropped: comment text is not code that can come back.
 *
 * Invariants:
 *   - Every returned block has lines.length >= minLines.
 *   - A deleted block never consists only of comment-like lines.
 *   - No line in block.lines is empty or whitespace-only.
 *   - Every line in block.lines appears in hunk.deletedLines / hunk.addedLines.
 */
export function extractBlocks(
  hunk: Hunk,
  side: 'deleted' | 'added',
  minLines: number,
): RawBlock[] {
  let sourceLines = side === 'deleted' ? hunk.deletedLines : hunk.addedLines;
  if (side === 'deleted' && hunk.startsInComment === true) {
    const close = sourceLines.findIndex(l => l.includes('*/'));
    sourceLines = close < 0 ? [] : sourceLines.slice(close + 1);
  }
  const hunkStart = side === 'deleted' ? hunk.oldStart : hunk.newStart;

  // Filter out blank lines; blanks do not end the run per REQ-3.
  const nonBlank = sourceLines.filter(l => l.trim().length > 0);

  if (nonBlank.length < minLines) return [];
  if (side === 'deleted' && nonBlank.every(isCommentLine)) return [];

  return [{ filePath: hunk.filePath, hunkStart, lines: nonBlank }];
}
