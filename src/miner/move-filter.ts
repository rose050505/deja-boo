import type { RawBlock, MinerConfig } from '../core/types.js';
import { containedIn, fingerprintLines } from '../core/match.js';
import { detectLanguage } from './language.js';
import { unionGrams } from './commit-grams.js';

/**
 * Remove deleted blocks whose code is still present after the commit: moved, re-indented or re-wrapped, not dead.
 *
 * A deleted block is dropped when at least `aliveAfterDeath` (default 0.97) of its fingerprint is contained in the k-grams of
 *   1. all lines the commit adds, of any size (`added`), or
 *   2. the post-commit content of the files the commit touches (`postCommitGrams`, when given).
 * Containment, not Jaccard: a block that moves into a larger file, or is re-wrapped into fewer lines, keeps all of its k-grams but shares few with the whole.
 * The default is high on purpose: a reformat or move keeps 96-100% of the fingerprint, while a real edit that drops a flag or kwarg keeps 93-95% (research/matching-eval.md section 9).
 *
 * Invariant: a block whose lines all appear in `added` (or whose k-grams all appear in `postCommitGrams`) is excluded for any threshold <= 1.0.
 */
export function filterMoved(
  deleted: RawBlock[],
  added: RawBlock[],
  config: Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize' | 'aliveAfterDeath'>,
  postCommitGrams?: ReadonlySet<number>,
): RawBlock[] {
  const addedGrams = unionGrams(added, config);
  return deleted.filter(block => !isStillAlive(block, addedGrams, postCommitGrams, config));
}

/**
 * Whether `block` is contained at aliveAfterDeath in the added grams or the post-commit grams.
 * Invariant: false for a block with an empty fingerprint (build-tombstone drops those).
 */
export function isStillAlive(
  block: RawBlock,
  addedGrams: ReadonlySet<number>,
  postCommitGrams: ReadonlySet<number> | undefined,
  config: Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize' | 'aliveAfterDeath'>,
): boolean {
  const fp = blockFingerprint(block, config);
  if (fp.length === 0) return false;
  if (containedIn(fp, addedGrams) >= config.aliveAfterDeath) return true;
  return postCommitGrams !== undefined && containedIn(fp, postCommitGrams) >= config.aliveAfterDeath;
}

/** Fingerprint of a block in its file's language. */
export function blockFingerprint(block: RawBlock, config: Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize'>): number[] {
  return fingerprintLines(block.lines, { ...config, language: detectLanguage(block.filePath) });
}
