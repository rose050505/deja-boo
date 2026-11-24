import type { Graveyard, MinerConfig, Tombstone } from '../core/types.js';
import { spawnGitLog } from './git-log.js';
import { parseDiff } from './parse-diff.js';
import { extractBlocks } from './block-extract.js';
import { filterMoved, isStillAlive } from './move-filter.js';
import { buildTombstone } from './build-tombstone.js';
import { applyGrace } from './grace-filter.js';
import { findRevivalCandidates, recordRevival, scanForReDeaths } from './revival-tracker.js';
import { changedRuns, patchId } from './commit-grams.js';
import { RepoReader } from './repo-reader.js';
import { computeStats } from './stats.js';
import { fingerprintHead } from './head-tree.js';
import { isAliveAtHead } from '../core/match.js';
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
  mergeArtifacts: number;
  aliveAtHead: number;
  /** Revival candidates rejected because the code was still in the parent tree (it never died). */
  revivalsNotDead: number;
  /** Revival candidates rejected because the death commit is not an ancestor of the revival commit. */
  revivalsNotAncestor: number;
  /** Revival candidates rejected because the same patch already revived the tombstone (cherry-pick, duplicate). */
  revivalsDuplicate: number;
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
  // spawnGitLog now yields oldest-first (--reverse --topo-order).
  const rawCommits: RawCommit[] = [];
  for await (const rawCommit of spawnGitLog(repo, config)) {
    rawCommits.push(rawCommit);
  }
  // No reversal needed; commits arrive oldest-first.

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
    mergeArtifacts: 0,
    aliveAtHead: 0,
    revivalsNotDead: 0,
    revivalsNotAncestor: 0,
    revivalsDuplicate: 0,
  };
  const reader = new RepoReader(repo, config);

  try {
    for (const rawCommit of rawCommits) {
      const parsed = parseDiff(rawCommit, config.skipPatterns);
      runStats.hunksParsed += parsed.hunks.length;

      // Collect deleted and added blocks across all hunks.
      const deletedBlocks = parsed.hunks.flatMap(h =>
        extractBlocks(h, 'deleted', config.minBlockLines),
      );

      runStats.blocksFound += deletedBlocks.length;

      // Move-filter: skip blocks whose code is still there after the commit (moved, re-indented, re-wrapped).
      // First against everything the commit adds, then against the post-commit content of the files it touches.
      let survived = filterMoved(deletedBlocks, changedRuns(parsed, 'added'), config);
      if (survived.length > 0) {
        const post = await reader.fileGrams(parsed.meta.hash, parsed.hunks.map(h => h.filePath));
        const none = new Set<number>();
        survived = survived.filter(b => !isStillAlive(b, none, post, config));
      }
      runStats.movesExcluded += deletedBlocks.length - survived.length;

      // Age-out pending tombstones whose grace window has expired before processing new ones.
      // Use committerTimestamp for all date math to stay correct across non-monotonic author dates.
      const commitTimeMs = parsed.meta.committerTimestamp * 1000;
      for (const [id, tombstone] of pendingGrace) {
        const buriedTimeMs = tombstone.buriedAtTimestamp * 1000;
        const daysDiff = (commitTimeMs - buriedTimeMs) / 86_400_000;
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
      const candidates = findRevivalCandidates(confirmed, parsed, config);
      if (candidates.length > 0) {
        const patch = patchId(parsed);
        let live = candidates.filter(c => {
          const dup = c.tombstone.revivals.some(r => r.patchId === patch);
          if (dup) runStats.revivalsDuplicate++;
          return !dup;
        });
        const followed: typeof live = [];
        for (const c of live) {
          if (await reader.isAncestor(c.tombstone.commit, parsed.meta.hash)) followed.push(c);
          else runStats.revivalsNotAncestor++;
        }
        live = followed;
        if (live.length > 0) {
          const wanted = Array.from(new Set(live.flatMap(c => c.tombstone.fingerprint))).sort((a, b) => a - b);
          const found = await reader.treeContains(`${parsed.meta.hash}^`, wanted);
          for (const c of live) {
            const fp = c.tombstone.fingerprint;
            const present = found === null ? 0 : fp.filter(h => found.has(h)).length / fp.length;
            if (present >= config.aliveBeforeRevival) { runStats.revivalsNotDead++; continue; }
            recordRevival(c.tombstone, parsed.meta, c.similarity, patch);
          }
        }
      }
      scanForReDeaths(confirmed, parsed, config);
    }
  } finally {
    reader.close();
  }

  // After the stream ends, flush remaining pending tombstones as confirmed.
  for (const [id, tombstone] of pendingGrace) {
    confirmed.set(id, tombstone);
    runStats.tombstonesAdded++;
  }
  pendingGrace.clear();

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

  // Mark tombstones whose code is still in the HEAD tree (same skip list as the walk).
  const head = await fingerprintHead(repo, config);
  for (const t of tombstones) {
    t.aliveAtHead = head !== null && isAliveAtHead(t.fingerprint, head);
    if (t.aliveAtHead) runStats.aliveAtHead++;
  }

  const stats = computeStats(tombstones, runStats.commitsWalked);
  runStats.revivals = stats.revivals;
  runStats.mergeArtifacts = stats.mergeArtifactRevivals;

  return { graveyard: { tombstones, stats }, stats: runStats };
}
