import { describe, it, expect } from 'vitest';
import { parseDiff, shouldSkip } from './parse-diff.js';
import type { RawCommit } from '../core/types.js';

function makeCommit(rawDiff: string): RawCommit {
  return {
    hash: 'a'.repeat(40),
    authorEmail: 'test@example.com',
    subject: 'test commit',
    body: '',
    authorDate: '2024-01-01T00:00:00Z',
    rawDiff,
  };
}

const DIFF_TWO_FILES = `\
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,3 @@
 const a = 1;
-const b = 2;
-const c = 3;
+const bc = 23;
 const d = 4;
diff --git a/src/bar.ts b/src/bar.ts
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -5,3 +5,4 @@
 function hello() {
-  return 'old';
+  return 'new';
+  // extra comment
 }`;

describe('parseDiff', () => {
  it('parses two hunks across two files correctly', () => {
    const result = parseDiff(makeCommit(DIFF_TWO_FILES), []);
    expect(result.hunks).toHaveLength(2);

    const h0 = result.hunks[0]!;
    expect(h0.filePath).toBe('src/foo.ts');
    expect(h0.oldStart).toBe(1);
    expect(h0.newStart).toBe(1);
    expect(h0.deletedLines).toEqual(['const b = 2;', 'const c = 3;']);
    expect(h0.addedLines).toEqual(['const bc = 23;']);

    const h1 = result.hunks[1]!;
    expect(h1.filePath).toBe('src/bar.ts');
    expect(h1.deletedLines).toEqual(["  return 'old';"]);
    expect(h1.addedLines).toEqual(["  return 'new';", '  // extra comment']);
  });

  it('file matching skip-pattern produces no hunks', () => {
    const result = parseDiff(makeCommit(DIFF_TWO_FILES), ['src/foo.ts']);
    const paths = result.hunks.map(h => h.filePath);
    expect(paths).not.toContain('src/foo.ts');
    expect(paths).toContain('src/bar.ts');
  });

  it('node_modules/ directory is skipped', () => {
    const diff = `\
diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js
--- a/node_modules/pkg/index.js
+++ b/node_modules/pkg/index.js
@@ -1,2 +1,2 @@
-old line
+new line`;
    const result = parseDiff(makeCommit(diff), ['node_modules/']);
    expect(result.hunks).toHaveLength(0);
  });

  it('--- / +++ header lines are not treated as deleted/added lines', () => {
    const result = parseDiff(makeCommit(DIFF_TWO_FILES), []);
    for (const hunk of result.hunks) {
      for (const line of hunk.deletedLines) {
        expect(line.startsWith('-- ')).toBe(false);
      }
      for (const line of hunk.addedLines) {
        expect(line.startsWith('++ ')).toBe(false);
      }
    }
  });

  it('diff with no hunks returns empty array', () => {
    const diff = `diff --git a/README.md b/README.md\n`;
    const result = parseDiff(makeCommit(diff), []);
    expect(result.hunks).toHaveLength(0);
  });

  it('binary file markers produce no hunks', () => {
    const diff = `\
diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;
    const result = parseDiff(makeCommit(diff), []);
    expect(result.hunks).toHaveLength(0);
  });

  it('meta fields are copied from the commit', () => {
    const commit = makeCommit('');
    const result = parseDiff(commit, []);
    expect(result.meta.hash).toBe(commit.hash);
    expect(result.meta.authorEmail).toBe(commit.authorEmail);
    expect(result.meta.subject).toBe(commit.subject);
    expect(result.meta.authorDate).toBe(commit.authorDate);
  });

  it('deleted lines have the leading - prefix stripped exactly once', () => {
    // A line like '-1' in source appears as '-1' in diff (actual diff prefix + content).
    // After prefix removal it must be '1'... wait: the diff line is '-<content>',
    // so '-1' as diff content means the original source had '-1'. After stripping
    // the diff '-' prefix we get '1'. But if original source is '--count', the diff
    // line is '---count', and we strip one '-', leaving '--count'. Let's verify:
    const diff = `\
diff --git a/main.c b/main.c
--- a/main.c
+++ b/main.c
@@ -1,2 +1,1 @@
---count;
+doSomething();`;
    const result = parseDiff(makeCommit(diff), []);
    expect(result.hunks[0]!.deletedLines).toEqual(['--count;']);
  });
});

describe('shouldSkip', () => {
  it('directory prefix skip works', () => {
    expect(shouldSkip('node_modules/pkg/index.js', ['node_modules/'])).toBe(true);
  });
  it('exact basename skip works', () => {
    expect(shouldSkip('some/path/package-lock.json', ['package-lock.json'])).toBe(true);
  });
  it('non-matching path is not skipped', () => {
    expect(shouldSkip('src/main.ts', ['node_modules/'])).toBe(false);
  });
});
