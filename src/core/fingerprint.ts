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

  // Build k-gram hashes.
  const hashes: number[] = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    const kgram = tokens.slice(i, i + k).join(' ');
    hashes.push(fnv1a32(kgram));
  }

  // Winnow: collect the minimum hash in each sliding window.
  const selected = new Set<number>();
  for (let i = 0; i <= hashes.length - w; i++) {
    let min = hashes[i] as number;
    for (let j = i + 1; j < i + w; j++) {
      if ((hashes[j] as number) < min) min = hashes[j] as number;
    }
    selected.add(min);
  }

  // Also handle the tail: if hashes.length < w there is only one window.
  if (hashes.length > 0 && hashes.length < w) {
    let min = hashes[0] as number;
    for (let j = 1; j < hashes.length; j++) {
      if ((hashes[j] as number) < min) min = hashes[j] as number;
    }
    selected.add(min);
  }

  return Array.from(selected).sort((a, b) => a - b);
}
