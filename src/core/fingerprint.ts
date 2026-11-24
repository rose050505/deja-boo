import type { MinerConfig } from './types.js';
import { tokenize } from './tokenize.js';

/**
 * FNV-1a 32-bit hash. Deterministic, inline, no dependencies.
 * Invariant: fnv1a32(s) === fnv1a32(s) for any string s.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // FNV prime 0x01000193; Math.imul for 32-bit multiplication, >>> 0 for unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Hashes of every token k-gram of `text`, before winnowing.
 * Invariant: every hash returned by kgramWinnow(text, config) is in this set.
 */
export function kgramHashSet(text: string, kgramSize: number): Set<number> {
  const tokens = tokenize(text);
  const out = new Set<number>();
  for (let i = 0; i + kgramSize <= tokens.length; i++) out.add(fnv1a32(tokens.slice(i, i + kgramSize).join(' ')));
  return out;
}

/**
 * FNV-1a hash of `tokens[at .. at+k)` joined by single spaces, without building the string.
 * Invariant: equals fnv1a32(tokens.slice(at, at + k).join(' ')).
 */
export function kgramHashAt(tokens: readonly string[], at: number, k: number): number {
  let hash = 0x811c9dc5;
  for (let t = 0; t < k; t++) {
    if (t > 0) hash = Math.imul(hash ^ 32, 0x01000193) >>> 0;
    const tok = tokens[at + t] as string;
    for (let i = 0; i < tok.length; i++) hash = Math.imul(hash ^ tok.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Winnow `hashes[from..to)`: the distinct minimum of every window of `w` hashes (one minimum when fewer than `w`), sorted ascending.
 * Invariant: empty for an empty range; the result is a subset of the range's values; equals the winnowing step of kgramWinnow.
 */
export function winnowHashes(hashes: ArrayLike<number>, from: number, to: number, w: number): number[] {
  const n = to - from;
  if (n <= 0) return [];
  const selected = new Set<number>();
  if (n < w) {
    let min = hashes[from] as number;
    for (let j = from + 1; j < to; j++) if ((hashes[j] as number) < min) min = hashes[j] as number;
    selected.add(min);
  } else {
    for (let i = from; i + w <= to; i++) {
      let min = hashes[i] as number;
      for (let j = i + 1; j < i + w; j++) if ((hashes[j] as number) < min) min = hashes[j] as number;
      selected.add(min);
    }
  }
  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Returns sorted, deduplicated winnowed k-gram hashes for the given text.
 * A text with fewer than kgramSize tokens returns [].
 * The result is deterministic and sorted ascending.
 */
export function kgramWinnow(
  text: string,
  config: Pick<MinerConfig, 'kgramSize' | 'windowSize'>,
): number[] {
  const { kgramSize: k, windowSize: w } = config;
  const tokens = tokenize(text);
  if (tokens.length < k) return [];
  const hashes: number[] = [];
  for (let i = 0; i <= tokens.length - k; i++) hashes.push(kgramHashAt(tokens, i, k));
  return winnowHashes(hashes, 0, hashes.length, w);
}
