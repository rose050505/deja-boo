import type { RawCommit, Hunk, ParsedCommit } from '../core/types.js';

/**
 * Check whether a file path should be skipped according to the skip-pattern list.
 * Handles: directory prefix (e.g. "node_modules/"), exact basename, and
 * simple wildcard patterns with "*" matching within a path segment.
 * Does not add a dependency on micromatch/minimatch.
 */
function shouldSkip(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);

  for (const pattern of patterns) {
    // Directory prefix: ends with /
    if (pattern.endsWith('/')) {
      if (
        normalized.startsWith(pattern) ||
        normalized.includes(`/${pattern}`)
      ) return true;
      continue;
    }
    // Exact basename
    if (!pattern.includes('/') && !pattern.includes('*')) {
      if (basename === pattern) return true;
      continue;
    }
    // Simple glob: replace * with [^/]* and match against full path or basename
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    const re = new RegExp(`(^|/)${escaped}(/|$)`);
    if (re.test(normalized)) return true;
  }
  return false;
}

/** Default skip patterns from REQ-2. */
export const DEFAULT_SKIP_PATTERNS: string[] = [
  // Binary extensions
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.pdf',
  '.zip', '.tar', '.gz', '.bin', '.exe', '.dll', '.so', '.dylib',
  // Lockfiles (exact basename)
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Gemfile.lock',
  'poetry.lock', 'Cargo.lock', 'go.sum', 'composer.lock',
  // Generated/minified — handled by special checks in shouldSkip
  // Vendored dirs
  'node_modules/', 'vendor/', 'third_party/', 'extern/', 'Pods/',
  // Build dirs
  'dist/', 'build/', 'out/', '__pycache__/', '.next/', '.nuxt/',
];

/** @internal Exported for testing. */
export { shouldSkip };

/** @internal Parse `@@ -oldStart,oldLen +newStart,newLen @@` header. */
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
  if (!m) return null;
  return { oldStart: parseInt(m[1] as string, 10), newStart: parseInt(m[2] as string, 10) };
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
      skipCurrentFile = currentFile !== null && shouldSkip(currentFile, skipPatterns);
      // Check generated/minified patterns not covered by directory prefix
      if (currentFile !== null && !skipCurrentFile) {
        const bn = currentFile.slice(currentFile.lastIndexOf('/') + 1);
        if (bn.includes('.min.') || bn.endsWith('.map')) {
          skipCurrentFile = true;
        }
      }
      continue;
    }

    // Hunk header
    if (line.startsWith('@@')) {
      const coords = parseHunkHeader(line);
      if (coords === null || currentFile === null || skipCurrentFile) {
        currentHunk = null;
        continue;
      }
      currentHunk = {
        filePath: currentFile,
        oldStart: coords.oldStart,
        newStart: coords.newStart,
        deletedLines: [],
        addedLines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (currentHunk === null) continue;

    // Deleted line: starts with '-' but is not '---'
    if (line.startsWith('-')) {
      currentHunk.deletedLines.push(line.slice(1));
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

  return { meta: { hash: commit.hash, authorEmail: commit.authorEmail, subject: commit.subject, body: commit.body, authorDate: commit.authorDate }, hunks: nonEmptyHunks };
}
