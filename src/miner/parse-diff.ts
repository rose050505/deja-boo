import type { RawCommit, Hunk, ParsedCommit } from '../core/types.js';

import { DEFAULT_SKIP_PATTERNS, shouldSkip, isSkippedPath } from '../core/skip.js';

export { DEFAULT_SKIP_PATTERNS, shouldSkip };

/** @internal Parse `@@ -oldStart,oldLen +newStart,newLen @@` header. */
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
  if (!m) return null;
  return { oldStart: parseInt(m[1] as string, 10), newStart: parseInt(m[2] as string, 10) };
}

/**
 * Whether the old file is inside a `/* ... *\/` block comment after `line`, given the state before it.
 * Cheap on purpose: only a line that starts with `/*` opens a comment (a `/*` inside a string or glob is ignored), and any `*\/` closes it.
 */
function nextCommentState(inComment: boolean, line: string): boolean {
  if (inComment) return !line.includes('*/');
  const t = line.trimStart();
  return t.startsWith('/*') && !t.includes('*/', 2);
}

/**
 * Parse a RawCommit's diff into structured hunks.
 * Lines prefixed with `-` (but not `---`) go into deletedLines *without* the prefix.
 * Lines prefixed with `+` (but not `+++`) go into addedLines *without* the prefix.
 * Hunks whose filePath matches skipPatterns are omitted entirely.
 */
export function parseDiff(commit: RawCommit, skipPatterns: string[]): ParsedCommit {
  const lines = commit.rawDiff.split('\n');
  const hunks: Hunk[] = [];

  let currentFile: string | null = null;
  let currentHunk: Hunk | null = null;
  let skipCurrentFile = false;
  /** Whether the old file is inside a block comment after the old-side lines of this git hunk seen so far. */
  let inComment = false;

  for (const line of lines) {
    // Binary-file marker
    if (/^Binary files .* differ/.test(line)) {
      currentHunk = null;
      continue;
    }

    // `--- a/path` header — marks new file (old side); we primarily use `+++` for path.
    if (line.startsWith('--- ')) {
      currentHunk = null;
      continue;
    }

    // `+++ b/path` header — start of a new file diff
    if (line.startsWith('+++ ')) {
      currentHunk = null;
      const rawPath = line.slice(4);
      // Strip `b/` prefix added by git diff
      const filePath = rawPath.startsWith('b/') ? rawPath.slice(2) : rawPath;
      currentFile = filePath === '/dev/null' ? null : filePath;
      skipCurrentFile = currentFile !== null && isSkippedPath(currentFile, skipPatterns);
      continue;
    }

    // Hunk header
    if (line.startsWith('@@')) {
      const coords = parseHunkHeader(line);
      if (coords === null || currentFile === null || skipCurrentFile) {
        currentHunk = null;
        continue;
      }
      inComment = false;
      currentHunk = {
        filePath: currentFile,
        oldStart: coords.oldStart,
        newStart: coords.newStart,
        deletedLines: [],
        addedLines: [],
        startsInComment: false,
      };
      hunks.push(currentHunk);
      continue;
    }

    if (currentHunk === null) continue;

    // Deleted line: starts with '-' but is not '---'
    if (line.startsWith('-')) {
      currentHunk.deletedLines.push(line.slice(1));
      inComment = nextCommentState(inComment, line.slice(1));
      continue;
    }

    // Added line: starts with '+' but is not '+++'
    if (line.startsWith('+')) {
      currentHunk.addedLines.push(line.slice(1));
      continue;
    }

    // Context line (space-prefixed or other) — close the current sub-hunk and open a fresh
    // one so that deletedLines/addedLines are always from one contiguous run.
    if (line.startsWith(' ') || line === '') {
      if (line.startsWith(' ')) inComment = nextCommentState(inComment, line.slice(1));
      if (currentFile !== null && !skipCurrentFile) {
        // Push a fresh sub-hunk; we keep the same file and line numbers are
        // approximate (hunkStart is the original @@ value; that is acceptable for
        // the tombstone id which only needs stability, not per-line accuracy).
        const fresh: Hunk = {
          filePath: currentHunk.filePath,
          oldStart: currentHunk.oldStart,
          newStart: currentHunk.newStart,
          deletedLines: [],
          addedLines: [],
          startsInComment: inComment,
        };
        currentHunk = fresh;
        hunks.push(currentHunk);
      }
      continue;
    }

    // Other lines (diff header lines etc.) — ignore
  }

  // Filter out empty hunks (sub-hunks created by context-line splits with no actual changes).
  const nonEmptyHunks = hunks.filter(h => h.deletedLines.length > 0 || h.addedLines.length > 0);

  return { meta: { hash: commit.hash, authorEmail: commit.authorEmail, subject: commit.subject, body: commit.body, authorDate: commit.authorDate, committerTimestamp: commit.committerTimestamp }, hunks: nonEmptyHunks };
}
