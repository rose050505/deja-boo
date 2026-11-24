import type {
  MinerConfig,
  ParsedCommit,
  RevivalRecord,
  DeathRecord,
  Tombstone,
} from '../core/types.js';
import { isRevertSubject } from '../core/revert.js';
import { containedIn, fingerprintLines, matchWindowed, similarity } from '../core/match.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import { matchWindowedIndexed, type WindowIndex } from '../core/watch.js';
import { extractBlocks } from './block-extract.js';
import { parseLinks } from './link-parser.js';
import { changedRuns, gramsByFile, patchId, unionGrams } from './commit-grams.js';
import { detectLanguage } from './language.js';

/**
 * Append a RevivalRecord to tombstone.revivals (sorted by committer date asc).
 * Sets isRevert: true when the commit subject is a Revert (`isRevertSubject`).
 *
 * Invariant: every revival committerTimestamp is strictly after tombstone.buriedAtTimestamp.
 */
export function recordRevival(
  tombstone: Tombstone,
  meta: ParsedCommit['meta'],
  sim: number,
  patch?: string,
): void {
  const record: RevivalRecord = {
    commit: meta.hash,
    date: new Date(meta.committerTimestamp * 1000).toISOString(),
    author: meta.authorEmail,
    subject: meta.subject,
    similarity: sim,
    isRevert: isRevertSubject(meta.subject),
    isMergeArtifact: /^merge/i.test(meta.subject),
    ...(patch !== undefined ? { patchId: patch } : {}),
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
  block: { lines: string[]; filePath?: string },
  meta: ParsedCommit['meta'],
  config: MinerConfig,
): void {
  const fp = fingerprintLines(block.lines, { ...config, language: block.filePath !== undefined ? detectLanguage(block.filePath) : undefined });
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

/** A tombstone whose code a commit seems to add back, with its best windowed Jaccard against the added lines. */
export interface RevivalCandidate {
  tombstone: Tombstone;
  similarity: number;
}

/**
 * Tombstones whose code a commit adds back, matched the way `check` matches a write: some window of the tombstone's line count
 * inside one run of added lines (any run size, so code that returns inside a larger block counts) has Jaccard >= moveThreshold.
 * Excluded: the same commit also deletes the code (at least aliveAfterDeath of the fingerprint in its deleted lines: a move or reformat).
 * These are candidates only: the caller still checks that the code was dead and that the commit follows the death.
 *
 * Invariant: a tombstone whose lines all appear, in order and contiguous, among one hunk's added lines, with none of them deleted by that commit, is a candidate for any threshold <= 1.0.
 */
export function findRevivalCandidates(
  tombstones: Map<string, Tombstone>,
  commit: ParsedCommit,
  config: MinerConfig,
): RevivalCandidate[] {
  if (tombstones.size === 0) return [];
  const runs = changedRuns(commit, 'added');
  if (runs.length === 0) return [];
  const addedByFile = gramsByFile(runs, config);
  const deletedGrams = unionGrams(changedRuns(commit, 'deleted'), config);
  const windows = new Map<string, Map<number, WindowIndex>>();
  const fastWindows = config.kgramSize === DEFAULT_MINER_CONFIG.kgramSize && config.windowSize === DEFAULT_MINER_CONFIG.windowSize && !config.renameIds;

  const out: RevivalCandidate[] = [];
  for (const tombstone of tombstones.values()) {
    // Prefilter: a window with Jaccard >= moveThreshold holds at least that share of the fingerprint among its file's k-grams.
    let best = 0;
    for (const [file, grams] of addedByFile) {
      if (containedIn(tombstone.fingerprint, grams) < config.moveThreshold) continue;
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i] as (typeof runs)[number];
        if (run.filePath !== file) continue;
        const key = `${i}:${tombstone.language}`;
        let cache = windows.get(key);
        if (!cache) windows.set(key, (cache = new Map()));
        // The indexed windows use the default k and w; other values take the plain (slower) windowing.
        const m = fastWindows
          ? matchWindowedIndexed(tombstone, run.lines, cache, config.moveThreshold, { language: tombstone.language })
          : matchWindowed(tombstone, run.lines, { ...config, language: tombstone.language });
        best = Math.max(best, m.similarity);
      }
    }
    if (best < config.moveThreshold) continue;
    if (containedIn(tombstone.fingerprint, deletedGrams) >= config.aliveAfterDeath) continue;
    out.push({ tombstone, similarity: best });
  }
  return out;
}

/**
 * Record re-deaths: deleted blocks of the commit matching a tombstone that already has at least one revival.
 * Invariant: never records a re-death for a tombstone without a revival.
 */
export function scanForReDeaths(
  tombstones: Map<string, Tombstone>,
  commit: ParsedCommit,
  config: MinerConfig,
): void {
  const deletedBlocks: Array<{ lines: string[]; filePath: string; fp: number[] }> = [];
  for (const hunk of commit.hunks) {
    for (const block of extractBlocks(hunk, 'deleted', config.minBlockLines)) {
      const fp = fingerprintLines(block.lines, { ...config, language: detectLanguage(block.filePath) });
      if (fp.length > 0) deletedBlocks.push({ lines: block.lines, filePath: block.filePath, fp });
    }
  }
  for (const tombstone of tombstones.values()) {
    if (tombstone.revivals.length === 0) continue;
    for (const deleted of deletedBlocks) {
      if (similarity(deleted.fp, tombstone.fingerprint) >= config.moveThreshold) {
        recordReDeath(tombstone, deleted, commit.meta, config);
        break; // one re-death per commit per tombstone
      }
    }
  }
}

/**
 * Scan a commit against confirmed tombstones using the commit alone: record every revival candidate and every re-death.
 * `runIndex` does not use this; it also checks the repository (the code was dead, the commit follows the death).
 * Invariant: records at most one revival and one re-death per tombstone per commit, and never twice for the same patch.
 */
export function scanForRevivals(
  tombstones: Map<string, Tombstone>,
  commit: ParsedCommit,
  config: MinerConfig,
): void {
  if (tombstones.size === 0) return;
  const patch = patchId(commit);
  for (const c of findRevivalCandidates(tombstones, commit, config)) {
    if (c.tombstone.revivals.some(r => r.patchId === patch)) continue;
    recordRevival(c.tombstone, commit.meta, c.similarity, patch);
  }
  scanForReDeaths(tombstones, commit, config);
}
