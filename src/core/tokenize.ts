/**
 * Splits text into identifiers, numbers and single punctuation characters.
 * Whitespace is dropped. Invariant: tokens joined with no separator equal the input minus whitespace.
 */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}_][\p{L}\p{N}_]*|\p{N}+|\S/gu) ?? [];
}
