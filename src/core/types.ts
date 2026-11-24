/**
 * Core shared types for Déjà Boo.
 * No runtime code except DEFAULT_MINER_CONFIG; no Node.js imports.
 */

import { resolveSkipPatterns } from './skip.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface MinerConfig {
  /** Minimum consecutive non-blank deleted lines to form a candidate block. */
  minBlockLines: number;
  /** k in k-gram winnowing (shingle width in tokens). */
  kgramSize: number;
  /** Sliding window size for winnowing. */
  windowSize: number;
  /** Replace identifier tokens with _ID_ before fingerprinting. */
  renameIds: boolean;
  /** Share of a tombstone's fingerprint that a commit's added lines must contain to count as re-adding it (grace window, revivals). */
  moveThreshold: number;
  /** Days after deletion within which a re-add drops the tombstone. */
  graceDays: number;
  /** A deleted block is not a death when at least this share of its fingerprint is in the commit's added lines or the touched files after the commit (moved, reformatted). See research/matching-eval.md section 9. */
  aliveAfterDeath: number;
  /**
   * A revival candidate is skipped when the share of the tombstone's fingerprint that is in the revival commit's parent tree, or in the lines the same commit deletes,
   * is at least the revival's own similarity minus this margin (the code never died, or it moved). Relative on purpose: see research/matching-eval.md section 11.
   */
  aliveMargin: number;
  /** A deleted block becomes a tombstone only with at least this many distinct winnowed hashes (idioms with 1-3 hashes fire on unrelated code). */
  minHashes: number;
  /** Limit walk to commits after this date (ISO or git date string). */
  since?: string;
  /** Limit walk to commits before this date (ISO or git date string). */
  until?: string;
  /** Glob patterns for file paths to skip entirely. */
  skipPatterns: string[];
}

/** Fewest distinct fingerprint hashes a tombstone needs to be watched; see research/matching-eval.md section 8. */
export const DEFAULT_MIN_HASHES = 4;

export const DEFAULT_MINER_CONFIG: MinerConfig = {
  minBlockLines: 4,
  minHashes: DEFAULT_MIN_HASHES,
  kgramSize: 5,
  windowSize: 4,
  renameIds: false,
  moveThreshold: 0.9,
  graceDays: 7,
  aliveAfterDeath: 0.97,
  aliveMargin: 0,
  skipPatterns: resolveSkipPatterns(),
};

// ─── Link ────────────────────────────────────────────────────────────────────

export interface Link {
  /** 'ref' is a bare `#N` whose kind (issue or pull request) is unknown. */
  type: 'issue' | 'pr' | 'ref';
  ref: string;
  url?: string;
}

// ─── Obituary ────────────────────────────────────────────────────────────────

/** A pull request or issue found on GitHub; `excerpt` is verbatim text from its body. */
export interface ObituaryRef {
  number: number;
  url: string;
  title: string;
  /** First 400 UTF-16 code units of the whitespace-collapsed body; never paraphrased or decorated. */
  excerpt: string;
  /** True when the collapsed body was longer than `excerpt`. */
  truncated: boolean;
}

/** What GitHub knows about one death commit. `pr: null` and `issues: []` means "looked up, nothing found". */
export interface Obituary {
  pr: ObituaryRef | null;
  issues: ObituaryRef[];
  /** ISO 8601 time of the lookup. */
  fetchedAt: string;
}

/** Contents of `.deja-boo/obituaries.json`, keyed by the 40-character death commit sha. */
export type ObituaryFile = Record<string, Obituary>;

// ─── Revival & death records ──────────────────────────────────────────────────

export interface RevivalRecord {
  commit: string;
  date: string;        // ISO 8601
  author: string;
  subject: string;
  /** Best windowed Jaccard of the tombstone against the commit's added lines (window = tombstone line count). */
  similarity: number;
  isRevert: boolean;
  /** True when the commit subject starts with "merge" (conflict-resolution commit); excluded from stats by default. */
  isMergeArtifact: boolean;
  /** Hash of the commit's change, ignoring line numbers and whitespace; the same patch cherry-picked or re-applied shares it. Revivals are counted once per patch. */
  patchId?: string;
}

export interface DeathRecord {
  commit: string;
  date: string;        // ISO 8601
  author: string;
  causeOfDeath: string;
  links: Link[];
  fingerprint: number[];
  lines: string[];
  similarity: number;
}

// ─── Tombstone ───────────────────────────────────────────────────────────────

export interface Tombstone {
  /** SHA-1 hex of "${commit}:${path}:${hunkStart}". */
  id: string;
  /** Winnowed k-gram hashes, sorted ascending. */
  fingerprint: number[];
  /** Winnowed k-gram hashes with every identifier renamed to a placeholder, sorted ascending. Scores multi-identifier renames; computed from `lines` when absent. */
  idFingerprint?: number[];
  /** Raw deleted lines without the leading '-'. */
  lines: string[];
  /** File path relative to repo root. */
  path: string;
  language: string;
  /** ISO 8601 author date of the deleting commit — display only. */
  buriedAt: string;
  /** Unix timestamp (seconds) of the deleting commit's committer date — used for all date logic. */
  buriedAtTimestamp: number;
  /** Full 40-char commit hash. */
  commit: string;
  /** Author email. */
  author: string;
  causeOfDeath: string;
  links: Link[];
  /** Revivals outside the grace window, ordered chronologically. */
  revivals: RevivalRecord[];
  /** Re-deaths after the first deletion, ordered chronologically. */
  deaths: DeathRecord[];
  /** True when >= 80% of the fingerprint occurs in the HEAD tree; `check` ignores these. Set by `index`. */
  aliveAtHead?: boolean;
  /** From `.deja-boo/obituaries.json`; attached in memory (or in the web JSON), never written to graveyard.json. */
  obituary?: Obituary;
}

// ─── Graveyard ───────────────────────────────────────────────────────────────

export interface GraveyardStats {
  commits: number;
  tombstones: number;
  revivals: number;
  revivalsViaRevert: number;
  /** Revivals from commits whose subject starts with "merge"; not counted in `revivals`. */
  mergeArtifactRevivals: number;
  /** Tombstones whose code is still at HEAD; counted in `tombstones` too. */
  aliveAtHead: number;
  /** Alive tombstones that stay watched because their cause of death is a Revert; subset of `aliveAtHead`. */
  aliveAtHeadReverts: number;
  medianRevivalGapDays: number | null;
}

export interface Graveyard {
  /** `https://github.com/<owner>/<repo>` of the origin remote; absent when there is no GitHub origin. */
  repoUrl?: string;
  tombstones: Tombstone[];
  stats: GraveyardStats;
}

// ─── Match result ─────────────────────────────────────────────────────────────

export interface Revenant {
  tombstone: Tombstone;
  /** Jaccard similarity of fingerprint sets, in [0, 1]. */
  similarity: number;
  matchedLines: string[];
}

/** Result of sliding a tombstone-sized window over candidate lines. */
export interface WindowedMatch {
  /** Best window Jaccard, in [0, 1]. The only score that may trigger a warning or block. */
  similarity: number;
  /** 1-based inclusive line range of the best window in the candidate; [0, 0] when nothing matched. */
  matchedLines: [number, number];
  /** |T ∩ W| / |T| for the best window. Evidence only; never triggers. */
  containment: number;
}

// ─── Watch ───────────────────────────────────────────────────────────────────

/** Similarity cut-offs for `hauntLevel`; 0 < warn <= block <= 1. */
export interface Thresholds {
  warn: number;
  block: number;
}

/** Contents of `.deja-boo/config.json`. */
export interface WatchConfig {
  thresholds: Thresholds;
  /** Tombstones with fewer distinct hashes are not watched; defaults to DEFAULT_MIN_HASHES. */
  minHashes?: number;
}

/** A revenant found by the watcher: a tombstone plus how strongly and where the candidate matches it. */
export interface RevenantHit {
  tombstone: Tombstone;
  level: 'warn' | 'block';
  similarity: number;
  containment: number;
  /** 1-based inclusive line range in the candidate. */
  matchedLines: [number, number];
  /** True when the identifier-renamed fingerprint produced `similarity` (after its penalty), not the raw one. */
  renamed?: boolean;
}

// ─── Internal miner types ─────────────────────────────────────────────────────

export interface RawCommit {
  hash: string;
  authorEmail: string;
  subject: string;
  body: string;
  /** ISO 8601 from --format=%aI — display-only; do not use for ordering. */
  authorDate: string;
  /** Unix timestamp (seconds) from --format=%ct — use for all date logic. */
  committerTimestamp: number;
  rawDiff: string;
}

export interface Hunk {
  filePath: string;
  oldStart: number;
  newStart: number;
  deletedLines: string[];
  addedLines: string[];
  /** True when the old file is inside a `/* ... *\/` block comment where this hunk starts (known only when the opener is in the diff's context). */
  startsInComment?: boolean;
}

export interface ParsedCommit {
  meta: Omit<RawCommit, 'rawDiff'>;
  hunks: Hunk[];
}

export interface RawBlock {
  filePath: string;
  /** Line number in the old file (from @@ header), for stable id. */
  hunkStart: number;
  /** Raw content without the '-' prefix. */
  lines: string[];
}
