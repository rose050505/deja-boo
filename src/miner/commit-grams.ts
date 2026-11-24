import { createHash } from 'node:crypto';
import type { MinerConfig, ParsedCommit, RawBlock } from '../core/types.js';
import { kgramSetOfLines } from '../core/match.js';
import { detectLanguage } from './language.js';

type GramConfig = Pick<MinerConfig, 'kgramSize' | 'windowSize' | 'renameIds'>;

/**
 * The non-blank lines of every hunk on one side of a commit as runs of any size (extractBlocks drops runs shorter than minBlockLines).
 * Invariant: every returned run is non-empty and holds no blank line.
 */
export function changedRuns(commit: ParsedCommit, side: 'added' | 'deleted'): RawBlock[] {
  const runs: RawBlock[] = [];
  for (const h of commit.hunks) {
    const lines = (side === 'added' ? h.addedLines : h.deletedLines).filter(l => l.trim().length > 0);
    if (lines.length > 0) runs.push({ filePath: h.filePath, hunkStart: side === 'added' ? h.newStart : h.oldStart, lines });
  }
  return runs;
}

/**
 * The k-gram hash sets of runs, joined per file path (each run normalized on its own, in its file's language).
 * Invariant: the union of the returned sets equals the union of the runs' k-gram sets.
 */
export function gramsByFile(runs: readonly RawBlock[], config: GramConfig): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  for (const run of runs) {
    let set = byFile.get(run.filePath);
    if (!set) byFile.set(run.filePath, (set = new Set()));
    for (const h of kgramSetOfLines(run.lines, { ...config, language: detectLanguage(run.filePath) })) set.add(h);
  }
  return byFile;
}

/** Union of the k-gram hash sets of runs. Invariant: contains the k-grams of every run. */
export function unionGrams(runs: readonly RawBlock[], config: GramConfig): Set<number> {
  const out = new Set<number>();
  for (const set of gramsByFile(runs, config).values()) for (const h of set) out.add(h);
  return out;
}

/**
 * Identifies a change by its content: the hunks' file paths and changed lines with all whitespace removed, in order, like `git patch-id`.
 * Invariant: independent of line numbers, whitespace, author and commit hash, so a cherry-pick of a commit has the same id.
 */
export function patchId(commit: ParsedCommit): string {
  const h = createHash('sha1');
  for (const hunk of commit.hunks) {
    h.update(`${hunk.filePath}\0`);
    for (const l of hunk.deletedLines) h.update(`-${l.replace(/\s+/g, '')}\n`);
    for (const l of hunk.addedLines) h.update(`+${l.replace(/\s+/g, '')}\n`);
  }
  return h.digest('hex');
}
