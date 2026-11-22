import type { Graveyard, MinerConfig, Tombstone } from '../core/types.js';
import { spawnGitLog } from './git-log.js';
import { parseDiff } from './parse-diff.js';
import { extractBlocks } from './block-extract.js';
import { filterMoved } from './move-filter.js';
import { buildTombstone } from './build-tombstone.js';
import { applyGrace } from './grace-filter.js';
import { scanForRevivals } from './revival-tracker.js';
import { computeStats } from './stats.js';
import type { RawCommit } from '../core/types.js';

export interface IndexStats {
  commitsWalked: number;
  hunksParsed: number;
  blocksFound: number;
  movesExcluded: number;
  graceDropped: number;
  skippedEmpty: number;
  tombstonesAdded: number;
  revivals: number;
}

/**
 * Mine git history and return a fully-assembled Graveyard.
 * Invariant: same repo + config always produces byte-identical JSON output.
 */
export async function runIndex(
  repo: string,
  config: MinerConfig,
): Promise<Graveyard> {
  const { graveyard } = await runIndexWithStats(repo, config);
  return graveyard;
}

/**
 * Mine git history and return both the Graveyard and miner-run statistics.
 */
export async function runIndexWithStats(
  repo: string,
  config: MinerConfig,
): Promise<{ graveyard: Graveyard; stats: IndexStats }> {
  // Collect all raw commits; spawnGitLog yields newest-first.
  // We need oldest-first for correct grace/revival tracking, so reverse.
  const rawCommits: RawCommit[] = [];
  for await (const rawCommit of spawnGitLog(repo, config)) {
    rawCommits.push(rawCommit);
  }
  // Process oldest-first (reverse of git's default).
  rawCommits.reverse();

  // Live map of tombstones: id → Tombstone.
  // Tombstones younger than graceDays stay in pendingGrace until they age out.
  const confirmed = new Map<string, Tombstone>();
  const pendingGrace = new Map<string, Tombstone>();

  const runStats: IndexStats = {
    commitsWalked: rawCommits.length,
    hunksParsed: 0,
    blocksFound: 0,
    movesExcluded: 0,
    graceDropped: 0,
    skippedEmpty: 0,
    tombstonesAdded: 0,
    revivals: 0,
  };

  for (const rawCommit of rawCommits) {
    const parsed = parseDiff(rawCommit, config.skipPatterns);
    runStats.hunksParsed += parsed.hunks.length;

    // Collect deleted and added blocks across all hunks.
    const deletedBlocks = parsed.hunks.flatMap(h =>
      extractBlocks(h, 'deleted', config.minBlockLines),
    );
    const addedBlocks = parsed.hunks.flatMap(h =>
      extractBlocks(h, 'added', config.minBlockLines),
    );

    runStats.blocksFound += deletedBlocks.length;

    // Move-filter: skip blocks that were just relocated in the same commit.
    const survived = filterMoved(deletedBlocks, addedBlocks, config);
    runStats.movesExcluded += deletedBlocks.length - survived.length;

    // Age-out pending tombstones whose grace window has expired before processing new ones.
    // This ensures the grace window is computed relative to the current commit's date.
    const commitTime = new Date(parsed.meta.authorDate).getTime();
    for (const [id, tombstone] of pendingGrace) {
      const buriedTime = new Date(tombstone.buriedAt).getTime();
      const daysDiff = (commitTime - buriedTime) / 86_400_000;
      if (daysDiff > config.graceDays) {
        confirmed.set(id, tombstone);
        pendingGrace.delete(id);
        runStats.tombstonesAdded++;
      }
    }

    // Build tombstones from surviving deleted blocks.
    for (const block of survived) {
      const tombstone = buildTombstone(block, parsed.meta, config);
      if (tombstone === null) {
        runStats.skippedEmpty++;
        continue;
      }
      // Dedup by id: first occurrence wins.
      if (!confirmed.has(tombstone.id) && !pendingGrace.has(tombstone.id)) {
        pendingGrace.set(tombstone.id, tombstone);
      }
    }

    // Grace-filter: drop pending tombstones re-added within the grace window.
    const toDrop = applyGrace(pendingGrace, parsed, config);
    for (const id of toDrop) {
      pendingGrace.delete(id);
      runStats.graceDropped++;
    }

    // Scan confirmed tombstones for revivals / re-deaths in this commit.
    scanForRevivals(confirmed, parsed, config);
  }

  // After the stream ends, flush remaining pending tombstones as confirmed.
  for (const [id, tombstone] of pendingGrace) {
    confirmed.set(id, tombstone);
    runStats.tombstonesAdded++;
  }
  pendingGrace.clear();

  // Count total revivals across all tombstones.
  for (const t of confirmed.values()) {
    runStats.revivals += t.revivals.length;
  }

  // Sort tombstones: buriedAt asc, then id asc for determinism.
  const tombstones = Array.from(confirmed.values()).sort((a, b) => {
    const dateCmp = a.buriedAt.localeCompare(b.buriedAt);
    return dateCmp !== 0 ? dateCmp : a.id.localeCompare(b.id);
  });

  // Sort revivals and deaths within each tombstone.
  for (const t of tombstones) {
    t.revivals.sort((a, b) => a.date.localeCompare(b.date));
    t.deaths.sort((a, b) => a.date.localeCompare(b.date));
  }

  const stats = computeStats(tombstones, runStats.commitsWalked);

  return { graveyard: { tombstones, stats }, stats: runStats };
}
