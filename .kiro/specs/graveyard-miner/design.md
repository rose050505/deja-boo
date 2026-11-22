# Graveyard Miner — Design

## Module map

```
src/core/
  types.ts          # Tombstone, Revenant, Link, MinerConfig, Graveyard, GraveyardStats, Fingerprint types
  normalize.ts      # normalizeBlock(lines, config) -> string
  fingerprint.ts    # kgramWinnow(text, config) -> number[]
  match.ts          # similarity(a, b) -> number  [used by check path, not miner]

src/miner/
  git-log.ts        # spawnGitLog(repo, options) -> AsyncIterable<RawCommit>
  parse-diff.ts     # parseDiff(raw: RawCommit) -> ParsedCommit
  block-extract.ts  # extractDeletedBlocks(hunks, minLines) -> RawBlock[]
  move-filter.ts    # filterMoved(deleted, added, config) -> RawBlock[]  [Jaccard >= moveThreshold]
  grace-filter.ts   # applyGrace(tombstones, laterCommits, config) -> Tombstone[]
  revival-tracker.ts # trackRevivals(tombstones, commits, config) -> Tombstone[]
  link-parser.ts    # parseLinks(message: string) -> Link[]
  language.ts       # detectLanguage(path: string) -> string
  build-tombstone.ts # buildTombstone(block, commit, config) -> Tombstone
  stats.ts          # computeStats(tombstones, commitsWalked) -> GraveyardStats
  index.ts          # runIndex(repo, config) -> Promise<Graveyard>  (orchestrator)

src/cli/
  index-command.ts  # "deja-boo index" command wiring
```

---

## Data flow

```
git log -p (spawned process)
    │  stdout stream (line by line)
    ▼
git-log.ts  ──►  AsyncIterable<RawCommit>
                        │
                        ▼
                 parse-diff.ts  ──►  ParsedCommit { meta, hunks[] }
                                              │
                              ┌───────────────┼──────────────────┐
                              ▼               ▼                  ▼
                     (deleted hunks)   (added hunks)     (commit meta)
                              │               │
                              ▼               ▼
                      block-extract    block-extract
                      (deleted runs)   (added runs)
                              │               │
                              └──────┬────────┘
                                     ▼
                              move-filter.ts
                              (Jaccard fingerprint similarity >= moveThreshold)
                                     │
                                     ▼  surviving deleted blocks
                              build-tombstone.ts
                              (normalize → fingerprint → Tombstone)
                                     │
                                     ▼
                              index.ts accumulates tombstones
                                     │
                              ┌──────┴────────────────────────┐
                              ▼                               ▼
                       grace-filter.ts               revival-tracker.ts
                  (drop tombstones re-added       (append RevivalRecord /
                   within graceDays window)        DeathRecord to keepers)
                              │                               │
                              └──────────────┬───────────────┘
                                             ▼
                              sort + dedup → GraveyardStats → Graveyard JSON
```

---

## Key types (`src/core/types.ts`)

```typescript
export interface MinerConfig {
  minBlockLines: number;   // default 4
  kgramSize: number;       // default 7
  windowSize: number;      // default 4
  renameIds: boolean;      // default false
  moveThreshold: number;   // default 0.9  (Jaccard, same-commit move detection)
  graceDays: number;       // default 7    (days after deletion to drop tombstone if re-added)
  since?: string;          // ISO date or git date string
  until?: string;
  skipPatterns: string[];  // glob patterns for paths to skip
}

export interface Link {
  type: 'issue' | 'pr';
  ref: string;
  url?: string;
}

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

export interface Tombstone {
  id: string;              // SHA-1 hex of "commit:path:hunkStart"
  fingerprint: number[];   // winnowed k-gram hashes, sorted ascending
  lines: string[];         // raw deleted lines (no leading '-')
  path: string;            // file path relative to repo root
  language: string;
  buriedAt: string;        // ISO 8601
  commit: string;          // 40-char hash
  author: string;          // email
  causeOfDeath: string;
  links: Link[];
  revivals: RevivalRecord[];   // ordered chronologically; empty if never revived
  deaths: DeathRecord[];       // re-deaths after the first; deaths[0] = second deletion
}

export interface GraveyardStats {
  commits: number;
  tombstones: number;
  revivals: number;
  revivalsViaRevert: number;
  medianRevivalGapDays: number | null;
}

export interface Graveyard {
  stats: GraveyardStats;
  tombstones: Tombstone[];
}

export interface Revenant {
  tombstone: Tombstone;
  similarity: number;      // Jaccard similarity of fingerprint sets, in [0,1]
  matchedLines: string[];
}

// Internal types (miner only, not exported from core)
export interface RawCommit {
  hash: string;
  authorEmail: string;
  subject: string;
  body: string;
  authorDate: string;      // ISO 8601 from --format=%aI
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
  hunkStart: number;      // line number in old file (for stable id)
  lines: string[];        // raw content (no '-' prefix)
}
```

---

## Module design

### `src/miner/git-log.ts`

Spawns `git log -p --no-merges --no-color --date=iso-strict` with a format that embeds a sentinel so the streaming parser can detect commit boundaries without buffering the whole file.

Format string:
```
--format="%x00COMMIT%x00%H%x00%ae%x00%aI%x00%s%n%b%x00END%x00"
```

The `\x00COMMIT\x00` sentinel marks the start of each commit header; `\x00END\x00` marks the end of the message before the diff begins. This lets the stream parser separate header from diff without ambiguity even when commit messages contain diff-like content.

The function yields `RawCommit` objects one at a time; it never buffers more than the current commit's lines.

### `src/miner/parse-diff.ts`

Consumes a `RawCommit.rawDiff` string and returns `Hunk[]`. Each `@@` header line opens a new hunk. Lines starting with `-` (not `---`) go into `deletedLines`; lines starting with `+` (not `+++`) go into `addedLines`; `---`/`+++` file headers capture the `filePath`.

**File filtering** lives here: before parsing a hunk, the function checks the file path against the skip-list patterns using a simple `micromatch`-compatible test (no dependency; a hand-rolled glob matcher covering `*`, `**`, and `?` suffices for the fixed patterns).

### `src/miner/block-extract.ts`

Scans `Hunk.deletedLines` (or `addedLines`) for runs of non-blank lines of length >= `minBlockLines`. Blank removed lines (empty or whitespace-only after stripping the `-` prefix) are skipped: they are neither counted toward the run length nor included in the block's content, and they do not end the current run. A run ends only when a context or added line is encountered. Returns `RawBlock[]` with `hunkStart` = the old-file line number from the `@@` header.

### `src/miner/move-filter.ts`

For each commit, collects all added blocks (same extraction logic). Fingerprints each added block's normalized content and unions their hash sets into a single commit-level added-fingerprint set. For each deleted block, computes Jaccard similarity between the block's fingerprint and the commit-level added-fingerprint set. If similarity ≥ `config.moveThreshold`, the block is excluded (moved, not dead).

This approach tolerates re-indented or lightly edited moves: even if the block was reformatted while being moved, the shingled hashes largely overlap.

### `src/miner/grace-filter.ts`

After the initial index pass has accumulated tombstones, a second pass over the commit stream checks whether any tombstone's block was re-added within `config.graceDays` of its `buriedAt` date. For each added block in a commit:
1. Compute its fingerprint.
2. For each pending tombstone whose `buriedAt` is within `graceDays` of the current commit's date, compute Jaccard similarity.
3. If similarity ≥ `config.moveThreshold`, drop the tombstone (split-refactor false positive).

Tombstones are only considered for grace-period removal while `commitDate - buriedAt <= graceDays`. Once that window has passed, they become permanent (unless later revived per REQ-14).

### `src/miner/revival-tracker.ts`

After tombstones are finalized (past the grace period), subsequent commits are scanned for re-additions:
1. For each added block in a commit, compute its fingerprint.
2. For each confirmed tombstone, compute Jaccard similarity against the added block.
3. If similarity ≥ `config.moveThreshold`, append a `RevivalRecord` to `tombstone.revivals[]`. Set `isRevert: true` if the commit subject starts with `"Revert"`.
4. If a previously revived tombstone's content is later deleted again (detected as a deleted block matching a tombstone), append a `DeathRecord` to `tombstone.deaths[]`.

The tracker runs as a streaming pass concurrent with the main index pass: it maintains a set of "live" tombstone ids to watch for re-deaths.

### `src/core/normalize.ts`

```
normalizeBlock(lines: string[], config: Pick<MinerConfig, 'renameIds'>): string
```

Steps (in order):
1. Strip the leading `-` or `+` prefix if present (defensive — callers should strip it, but normalize handles it).
2. Remove single-line comments: `//…`, `#…`, `--…` (only when the comment occupies the rest of the line; inline partial removal is out of scope to avoid false stripping in strings).
3. Remove block comments: `/* … */`, `<!-- … -->`, `{- … -}` (across lines if needed; use a simple state machine, not regex with backtracking).
4. Strip leading/trailing whitespace from each line; drop now-empty lines.
5. Collapse internal whitespace runs to a single space.
6. If `renameIds`: tokenize by `\W+` and replace tokens matching `[A-Za-z_][A-Za-z0-9_]*` that are not in a small reserved-words set with `_ID_`.
7. Join lines with `\n`.

Idempotent by construction (each step is idempotent and their composition is idempotent).

### `src/core/fingerprint.ts`

```
kgramWinnow(text: string, config: Pick<MinerConfig, 'kgramSize' | 'windowSize'>): number[]
```

Steps:
1. Tokenize: `text.split(/\s+/).filter(Boolean)` → token array.
2. If `tokens.length < kgramSize`, return `[]`.
3. Build k-grams: for `i` in `[0, tokens.length - k)`, join tokens `[i..i+k)` with `' '`.
4. Hash each k-gram with FNV-1a 32-bit.
5. Winnow: slide a window of size `windowSize` over the hash array; take the minimum of each window position. Collect selected hashes into a `Set<number>` (deduplicate).
6. Return `Array.from(set).sort((a, b) => a - b)`.

FNV-1a 32-bit is implemented inline (< 10 lines) using `Math.imul` and `>>> 0` for unsigned semantics, avoiding a dependency.

### `src/miner/build-tombstone.ts`

Assembles a `Tombstone` from a `RawBlock` + `ParsedCommit.meta` + config:
1. Compute `id`: `sha1Hex(`${commit}:${path}:${hunkStart}`)`.
   - SHA-1 is used for a stable, short id. Implemented via Node's `crypto.createHash('sha1')` (miner-only code, Node is fine here).
2. Normalize lines → fingerprint.
3. If fingerprint is empty, return `null` (block is too short after normalization).
4. Detect language from path.
5. Parse links from commit message.
6. Compose and return `Tombstone`.

### `src/miner/index.ts` (orchestrator)

```typescript
async function runIndex(repo: string, config: MinerConfig): Promise<Graveyard>
```

1. Stream commits from `git-log.ts` in reverse-chronological order.
2. For each commit: parse diff, extract deleted blocks, extract added blocks, run move filter (Jaccard ≥ `moveThreshold`), build tombstones for survivors.
3. Accumulate tombstones in a `Map<string, Tombstone>` (keyed by `id` for dedup).
4. During the stream, for each commit that falls within the grace window of an existing tombstone, run the grace filter and remove false-positive tombstones.
5. After the grace window for all tombstones has passed, run the revival tracker for subsequent commits: append `RevivalRecord` and `DeathRecord` entries to affected tombstones.
6. After the stream ends: sort tombstone array by `buriedAt` asc, then `id` asc. Sort `revivals` and `deaths` within each tombstone by date ascending.
7. Compute `GraveyardStats`.
8. Return `{ tombstones, stats }` as a `Graveyard`.

---

## Fingerprint similarity (used by `match.ts`, not the miner)

Jaccard similarity: `|A ∩ B| / |A ∪ B|`. Both sets are sorted arrays; intersection and union can be computed in O(n + m) with two pointers. This is used by the `check` path, the move filter, the grace filter, and the revival tracker. The miner uses it internally for move/grace/revival comparisons; the `check` path uses it for detecting revenants in new code.

---

## ID stability

The tombstone `id` is `sha1("${commit40}:${repoRelativePath}:${hunkOldStartLine}")`.

- `commit40` is immutable once committed.
- `repoRelativePath` is taken from the `b/` side of the diff header (or `a/` for pure deletions), normalized to forward slashes.
- `hunkOldStartLine` is the integer from the `@@ -N,M +P,Q @@` header.

This guarantees that re-indexing the same repo produces the same ids for the same events.

---

## Skip-list implementation

Rather than adding `micromatch` or `minimatch`, the skip-list patterns are checked with a small hand-rolled function:

```typescript
function shouldSkip(filePath: string, patterns: string[]): boolean
```

It handles three cases:
1. **Exact extension match**: `.min.js`, `.map` — check `filePath.includes('.min.')` or `filePath.endsWith('.map')` etc.
2. **Directory prefix**: `node_modules/`, `vendor/` — check `filePath.startsWith(prefix)` or `('/' + filePath).includes('/' + prefix)`.
3. **Exact filename**: `package-lock.json` — check `basename(filePath) === name`.

This avoids a glob library while keeping the patterns readable and easy to extend.

---

## Streaming architecture

`git log -p` on a large repo produces hundreds of MB of output. To stay within the 60 s / low-memory target:

- `child_process.spawn` (not `exec`) with `stdout` as a stream.
- Lines are accumulated with a `readline`-style splitter that emits one line at a time.
- Each commit's raw diff is held in memory only until its tombstones are extracted, then discarded.
- The tombstone accumulator holds only the final `Tombstone` objects (a few hundred bytes each).

Estimated memory ceiling for a 5,000-commit repo: < 50 MB.

---

## Determinism guarantees

| Source of non-determinism | Mitigation |
|---|---|
| Commit traversal order | `git log` default is topological + date; same repo = same order |
| Hash collisions in fingerprint | FNV-1a is deterministic; no randomness |
| Set iteration order | `fingerprint` array is explicitly sorted ascending before storing |
| JSON key order | Tombstone keys are written in a fixed alphabetical order via a `sortedStringify` helper |
| Tombstone array order | Sorted by `buriedAt` asc, then `id` asc |
| `revivals` / `deaths` order | Sorted by `date` asc within each tombstone |
| `fingerprint` in `DeathRecord` | Sorted ascending |

---

## Error handling

| Condition | Behaviour |
|---|---|
| `git` not on PATH | Throw `MinerError("git binary not found")` before spawning |
| Path is not a git repo | `git log` exits non-zero; propagate as `MinerError` with stderr |
| Commit message is empty | `causeOfDeath = "cause of death unknown"` |
| Block too short after normalization | Silently discard (fingerprint is empty) |
| `--out` directory missing | Create with `fs.mkdirSync(dir, { recursive: true })` |
| Duplicate tombstone id | Keep first; log at `--verbose` |
