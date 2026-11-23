import type {
  MinerConfig,
  ParsedCommit,
  RevivalRecord,
  DeathRecord,
  Tombstone,
} from '../core/types.js';
import { normalizeBlock } from '../core/normalize.js';
import { kgramWinnow } from '../core/fingerprint.js';
import { similarity } from '../core/match.js';
import { extractBlocks } from './block-extract.js';
import { parseLinks } from './link-parser.js';

/**
 * Append a RevivalRecord to tombstone.revivals (sorted by committer date asc).
 * Sets isRevert: true when the commit subject starts with "Revert".
 *
 * Invariant: every revival committerTimestamp is strictly after tombstone.buriedAtTimestamp.
 */
export function recordRevival(
  tombstone: Tombstone,
  meta: ParsedCommit['meta'],
  sim: number,
): void {
  const record: RevivalRecord = {
    commit: meta.hash,
    date: new Date(meta.committerTimestamp * 1000).toISOString(),
    author: meta.authorEmail,
    subject: meta.subject,
    similarity: sim,
    isRevert: meta.subject.startsWith('Revert'),
    isMergeArtifact: /^merge/i.test(meta.subject),
  };
  tombstone.revivals.push(record);
  tombstone.revivals.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Append a DeathRecord to tombstone.deaths (sorted by committer date asc).
 * The similarity is Jaccard between the re-deleted block and the tombstone's
 * original fingerprint.
 *
 * Invariant: every death committerTimestamp is strictly after the preceding revival's.
 */
export function recordReDeath(
  tombstone: Tombstone,
  block: { lines: string[] },
  meta: ParsedCommit['meta'],
  config: MinerConfig,
): void {
  const norm = normalizeBlock(block.lines, config);
  const fp = kgramWinnow(norm, config);
  const sim = similarity(fp, tombstone.fingerprint);

  const causeOfDeath =
    meta.subject.trim().length === 0
      ? 'cause of death unknown'
      : `${meta.subject.trim()}${meta.body.trim().length > 0 ? '\n\n' + meta.body.trim() : ''}`;

  const record: DeathRecord = {
    commit: meta.hash,
    date: new Date(meta.committerTimestamp * 1000).toISOString(),
    author: meta.authorEmail,
    causeOfDeath,
    links: parseLinks(`${meta.subject}\n${meta.body}`),
    fingerprint: fp.slice().sort((a, b) => a - b),
    lines: block.lines,
    similarity: sim,
  };
  tombstone.deaths.push(record);
  tombstone.deaths.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Scan a commit's added and deleted blocks against confirmed tombstones.
 * Records revivals (added blocks matching a tombstone) and re-deaths
 * (deleted blocks matching a tombstone that already has at least one revival).
 */
export function scanForRevivals(
  tombstones: Map<string, Tombstone>,
  commit: ParsedCommit,
  config: MinerConfig,
): void {
  if (tombstones.size === 0) return;

  // Build added fingerprints and deleted fingerprints per block for this commit.
  const addedBlocks: Array<{ lines: string[]; fp: number[] }> = [];
  const deletedBlocks: Array<{ lines: string[]; fp: number[] }> = [];

  for (const hunk of commit.hunks) {
    for (const block of extractBlocks(hunk, 'added', config.minBlockLines)) {
      const norm = normalizeBlock(block.lines, config);
      const fp = kgramWinnow(norm, config);
      if (fp.length > 0) addedBlocks.push({ lines: block.lines, fp });
    }
    for (const block of extractBlocks(hunk, 'deleted', config.minBlockLines)) {
      const norm = normalizeBlock(block.lines, config);
      const fp = kgramWinnow(norm, config);
      if (fp.length > 0) deletedBlocks.push({ lines: block.lines, fp });
    }
  }

  for (const tombstone of tombstones.values()) {
    // Check added blocks for revivals.
    for (const added of addedBlocks) {
      const sim = similarity(added.fp, tombstone.fingerprint);
      if (sim >= config.moveThreshold) {
        recordRevival(tombstone, commit.meta, sim);
        break; // one revival per commit per tombstone
      }
    }

    // Check deleted blocks for re-deaths (only if there's already been a revival).
    if (tombstone.revivals.length > 0) {
      for (const deleted of deletedBlocks) {
        const sim = similarity(deleted.fp, tombstone.fingerprint);
        if (sim >= config.moveThreshold) {
          recordReDeath(tombstone, deleted, commit.meta, config);
          break; // one re-death per commit per tombstone
        }
      }
    }
  }
}
