import { createHash } from 'node:crypto';
import type { RawBlock, Tombstone, MinerConfig, ParsedCommit } from '../core/types.js';
import { normalizeBlock } from '../core/normalize.js';
import { kgramWinnow } from '../core/fingerprint.js';
import { detectLanguage } from './language.js';
import { parseLinks } from './link-parser.js';

/**
 * Build a Tombstone from a surviving deleted block and its commit metadata.
 * Returns null if the fingerprint is empty or has fewer than config.minHashes distinct hashes (too short, or an idiom that fires on unrelated code).
 *
 * Invariant: same inputs always produce the same id.
 */
export function buildTombstone(
  block: RawBlock,
  meta: ParsedCommit['meta'],
  config: MinerConfig,
): Tombstone | null {
  const normalized = normalizeBlock(block.lines, config);
  const fingerprint = kgramWinnow(normalized, config);

  if (fingerprint.length === 0 || fingerprint.length < config.minHashes) return null;

  // Stable id: sha1("${commit}:${path}:${hunkStart}")
  const id = createHash('sha1')
    .update(`${meta.hash}:${block.filePath}:${block.hunkStart}`)
    .digest('hex');

  const causeOfDeath =
    meta.subject.trim().length === 0
      ? 'cause of death unknown'
      : `${meta.subject.trim()}${meta.body.trim().length > 0 ? '\n\n' + meta.body.trim() : ''}`;

  return {
    id,
    fingerprint: fingerprint.slice().sort((a, b) => a - b),
    lines: block.lines,
    path: block.filePath,
    language: detectLanguage(block.filePath),
    buriedAt: meta.authorDate,
    buriedAtTimestamp: meta.committerTimestamp,
    commit: meta.hash,
    author: meta.authorEmail,
    causeOfDeath,
    links: parseLinks(`${meta.subject}\n${meta.body}`),
    revivals: [],
    deaths: [],
  };
}
