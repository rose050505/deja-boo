/**
 * Core shared types for Déjà Boo.
 * No runtime code except DEFAULT_MINER_CONFIG; no Node.js imports.
 */

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
  /** Jaccard threshold for move detection and grace/revival matching. */
  moveThreshold: number;
  /** Days after deletion within which a re-add drops the tombstone. */
  graceDays: number;
  /** Limit walk to commits after this date (ISO or git date string). */
  since?: string;
  /** Limit walk to commits before this date (ISO or git date string). */
  until?: string;
  /** Glob patterns for file paths to skip entirely. */
  skipPatterns: string[];
}

export const DEFAULT_MINER_CONFIG: MinerConfig = {
  minBlockLines: 4,
  kgramSize: 7,
  windowSize: 4,
  renameIds: false,
  moveThreshold: 0.9,
  graceDays: 7,
  skipPatterns: [],
};

// ─── Link ────────────────────────────────────────────────────────────────────

export interface Link {
  type: 'issue' | 'pr';
  ref: string;
  url?: string;
}

// ─── Revival & death records ──────────────────────────────────────────────────

export interface RevivalRecord {
  commit: string;
  date: string;        // ISO 8601
  author: string;
  subject: string;
  similarity: number;
  isRevert: boolean;
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
}

// ─── Graveyard ───────────────────────────────────────────────────────────────

export interface GraveyardStats {
  commits: number;
  tombstones: number;
  revivals: number;
  revivalsViaRevert: number;
  medianRevivalGapDays: number | null;
}

export interface Graveyard {
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
