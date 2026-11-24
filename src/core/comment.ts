/**
 * True for a blank line or a line that is only comment syntax or comment text: `*`, `* text`, `*/`, `/* ...`, `// ...`, `# ...`.
 * `#` counts only as a comment marker (alone, or followed by space, `#`, `!` or `:`), so `#include`, `#define`, `#[derive]` and CSS `#id` are code.
 * A `*` counts only when alone or followed by whitespace or `/`, so a pointer dereference `*p = 1;` is code.
 * Invariant: a blank line is always comment-like; a line that starts with a letter, digit or bracket never is.
 */
export function isCommentLine(line: string): boolean {
  const t = line.trim();
  if (t === '') return true;
  if (t.startsWith('//') || t.startsWith('/*')) return true;
  if (/^\*($|[\s/])/.test(t)) return true;
  return /^#+($|[\s!:])/.test(t);
}
