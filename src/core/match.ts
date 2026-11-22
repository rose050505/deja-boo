/**
 * Jaccard similarity between two sorted fingerprint arrays.
 * Uses a two-pointer O(n + m) intersection/union.
 * Invariant: similarity(fp, fp) === 1 for any non-empty fp; result in [0, 1].
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  let intersection = 0;
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const av = a[i] as number;
    const bv = b[j] as number;
    if (av === bv) {
      intersection++;
      i++;
      j++;
    } else if (av < bv) {
      i++;
    } else {
      j++;
    }
  }

  // |A ∪ B| = |A| + |B| - |A ∩ B|
  const union = a.length + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}
