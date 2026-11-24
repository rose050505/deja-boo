/**
 * True when the first line of `text` starts with revert, reverts, reverted or reverting as a whole word (case-insensitive).
 * Invariant: the only revert test in the repository; it looks at the first line only, so a body that mentions "revert" never counts.
 */
export function isRevertSubject(text: string): boolean {
  const firstLine = text.split('\n', 1)[0] ?? '';
  return /^\s*revert(?:s|ed|ing)?\b/i.test(firstLine);
}
