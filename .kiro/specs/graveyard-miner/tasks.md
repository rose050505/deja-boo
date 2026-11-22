# Graveyard Miner — Tasks

## Implementation order

Tasks are ordered so each one builds on the previous. Complete them in sequence; do not skip ahead.

---

## Task 1 — Core types ✅

**File:** `src/core/types.ts`

Define and export all shared TypeScript interfaces:

- `MinerConfig` — `minBlockLines`, `kgramSize`, `windowSize`, `renameIds`, `moveThreshold`, `graceDays`, `since?`, `until?`, `skipPatterns`.
- `Link` — `type: 'issue' | 'pr'`, `ref: string`, `url?: string`.
- `RevivalRecord` — `commit`, `date`, `author`, `subject`, `similarity`, `isRevert`.
- `DeathRecord` — `commit`, `date`, `author`, `causeOfDeath`, `links`, `fingerprint`, `lines`, `similarity`.
- `Tombstone` — all fields from REQ-7 and REQ-14: existing fields plus `revivals: RevivalRecord[]` and `deaths: DeathRecord[]`.
- `GraveyardStats` — `commits`, `tombstones`, `revivals`, `revivalsViaRevert`, `medianRevivalGapDays`.
- `Graveyard` — `{ tombstones: Tombstone[], stats: GraveyardStats }`.
- `Revenant` — `tombstone`, `similarity`, `matchedLines`.

Also export internal types used only by the miner (they can live in a separate `src/miner/types.ts` if preferred, but all the above must be in `src/core/types.ts`):
- `RawCommit`, `Hunk`, `ParsedCommit`, `RawBlock`.

Provide `DEFAULT_MINER_CONFIG: MinerConfig` with the default values from REQ-1 / REQ-4 / REQ-5 / REQ-6 (`moveThreshold: 0.9`, `graceDays: 7`).

**Acceptance:** TypeScript compiles with `strict: true` and no `any`. No runtime code, only types and the config constant.

---

## Task 2 — Normalize (`src/core/normalize.ts`) ✅

**File:** `src/core/normalize.ts`

Implement `normalizeBlock(lines: string[], config: Pick<MinerConfig, 'renameIds'>): string` following the six-step algorithm in design.md.

Export nothing else from this file.

**Acceptance criteria:**
- `normalizeBlock(normalizeBlock(lines, cfg).split('\n'), cfg) === normalizeBlock(lines, cfg)` (idempotent).
- Comment-only lines are dropped entirely.
- Blank lines (after stripping) are dropped.
- With `renameIds: true`, `['let foo = bar + 1']` and `['let baz = qux + 1']` normalize to the same string.
- With `renameIds: false`, they do not.

**Property tests (fast-check) — add to `src/core/normalize.test.ts`:**
1. **Idempotency**: for any array of arbitrary strings, `normalize(normalize(x)) === normalize(x)`.
2. **Whitespace invariance**: adding or removing leading/trailing spaces on any line does not change the output.
3. **Comment-only invariance**: a block consisting only of `// …` comment lines normalizes to the same as an empty block.
4. **renameIds symmetry**: with `renameIds: true`, two blocks that differ only in identifier names produce equal normalized output.

---

## Task 3 — Fingerprint (`src/core/fingerprint.ts`) ✅

**File:** `src/core/fingerprint.ts`

Implement:
- `fnv1a32(text: string): number` — FNV-1a 32-bit hash. Inline, no dependency.
- `kgramWinnow(text: string, config: Pick<MinerConfig, 'kgramSize' | 'windowSize'>): number[]` — returns sorted deduplicated winnowed hashes.

Export both functions.

**Acceptance criteria:**
- `kgramWinnow(text, cfg)` is deterministic across calls and processes.
- A text with fewer than `kgramSize` tokens returns `[]`.
- The returned array is sorted ascending with no duplicates.
- No Node.js imports.

**Property tests — add to `src/core/fingerprint.test.ts`:**
1. **Determinism**: `kgramWinnow(t, cfg)` called twice returns deeply equal arrays.
2. **Self-similarity**: `jaccardSimilarity(fp, fp) === 1` for any non-empty fingerprint.
3. **Symmetry**: `jaccardSimilarity(a, b) === jaccardSimilarity(b, a)`.
4. **Bounded**: every result of `jaccardSimilarity` is in `[0, 1]`.
5. **Short-text empty**: any text with fewer tokens than `k` returns `[]`.
6. **Sorted**: the result array is always sorted ascending.

(Implement a local `jaccardSimilarity(a: number[], b: number[]): number` helper in the test file for properties 2–4; it will later move to `match.ts`.)

---

## Task 4 — Match (`src/core/match.ts`) ✅

**File:** `src/core/match.ts`

Implement `similarity(a: number[], b: number[]): number` using Jaccard similarity on sorted arrays (two-pointer intersection/union, O(n + m)).

Export only `similarity`.

**Acceptance criteria:**
- `similarity([], [])` returns `0`.
- `similarity(fp, fp) === 1` for any non-empty `fp`.
- Result is always in `[0, 1]`.
- No Node.js imports.

**Property tests — add to `src/core/match.test.ts`:**
1. **Identity**: `similarity(fp, fp) === 1` for any `fp` with at least one element.
2. **Symmetry**: `similarity(a, b) === similarity(b, a)`.
3. **Bounded**: result is always in `[0, 1]`.
4. **Monotonicity**: if threshold `t1 < t2`, the set of pairs exceeding `t2` is a subset of pairs exceeding `t1`.
5. **Empty**: `similarity([], x) === 0` for any `x`.

---

## Task 5 — Language detection (`src/miner/language.ts`)

**File:** `src/miner/language.ts`

Implement `detectLanguage(filePath: string): string` using the lookup table from REQ-8.

Export only `detectLanguage`.

**Unit tests — add to `src/miner/language.test.ts`:**
- Each row in the REQ-8 table has a passing test case.
- An unknown extension returns `'unknown'`.
- Path with multiple dots (e.g., `foo.test.ts`) returns `'typescript'`.

---

## Task 6 — Link parser (`src/miner/link-parser.ts`)

**File:** `src/miner/link-parser.ts`

Implement `parseLinks(message: string): Link[]` following the patterns in REQ-9.

Export only `parseLinks`.

**Unit tests — add to `src/miner/link-parser.test.ts`:**
- `'fixes #42'` → `[{ type: 'issue', ref: '42' }]`.
- `'closes #10, resolves #11'` → two links.
- Full GitHub URL for a pull → `type: 'pr'`.
- Full GitHub URL for an issue → `type: 'issue'`.
- Same ref appearing twice (bare + URL) → deduplicated to one entry.
- Empty message → `[]`.

---

## Task 7 — Diff parser (`src/miner/parse-diff.ts`)

**File:** `src/miner/parse-diff.ts`

Implement `parseDiff(commit: RawCommit, skipPatterns: string[]): ParsedCommit`.

- Parse `---`/`+++` file headers to extract `filePath` from the `b/` side.
- Parse `@@ -oldStart,oldLen +newStart,newLen @@` headers to open hunks.
- Classify lines into `deletedLines` (prefix `-`, not `---`) and `addedLines` (prefix `+`, not `+++`).
- Skip hunks whose `filePath` matches the skip-list (see design.md skip-list implementation).

Export only `parseDiff`.

**Unit tests — add to `src/miner/parse-diff.test.ts`:**
- A minimal synthetic diff string with two hunks across two files parses to the correct `Hunk[]`.
- A file matching a skip-pattern produces no hunks.
- A `---`/`+++` header line is not treated as a deleted/added line.
- A diff with no hunks returns an empty array.
- Binary file markers (`Binary files ... differ`) produce no hunks.

---

## Task 8 — Block extractor (`src/miner/block-extract.ts`)

**File:** `src/miner/block-extract.ts`

Implement `extractBlocks(hunk: Hunk, side: 'deleted' | 'added', minLines: number): RawBlock[]`.

- Scans `hunk.deletedLines` or `hunk.addedLines` for runs of non-blank lines >= `minLines`.
- Blank removed lines (empty or whitespace-only after stripping the leading `-`/`+` prefix) are skipped: they do not count toward the run length, are not included in `block.lines`, and do not end the current run.
- A run ends only when a context line (space-prefixed) or a line from the opposite side is encountered — that is, when the input line array itself ends or the caller indicates a hunk boundary.
- Returns one `RawBlock` per run, with `hunkStart` = `hunk.oldStart` (for deleted) or `hunk.newStart` (for added).

Export only `extractBlocks`.

**Unit tests — add to `src/miner/block-extract.test.ts`:**
- A run of 6 non-blank deleted lines produces one block.
- A run of 3 lines (below default minimum) produces no block.
- Two runs separated by a non-removed line produce two blocks.
- A blank line in the middle of a run does not break it, and is not in `block.lines`.
- A hunk with only blank deleted lines produces no block.
- A blank line at the start of a run is skipped; the run still forms if enough non-blank lines follow.

**Property tests:**
1. **Coverage**: every line in a returned block appears in the original hunk's deleted/added lines.
2. **Minimum length**: every returned block has `lines.length >= minLines`.
3. **No blanks in output**: no line in `block.lines` is empty or whitespace-only.

---

## Task 9 — Move filter (`src/miner/move-filter.ts`)

**File:** `src/miner/move-filter.ts`

Implement `filterMoved(deleted: RawBlock[], added: RawBlock[], config: Pick<MinerConfig, 'renameIds' | 'kgramSize' | 'windowSize' | 'moveThreshold'>): RawBlock[]`.

- Fingerprint each added block's normalized content and union all resulting hash sets into a single `commitAddedFingerprint: number[]` (sorted, deduplicated).
- For each deleted block, compute its fingerprint. Compute Jaccard similarity between the deleted block's fingerprint and `commitAddedFingerprint`.
- If similarity ≥ `config.moveThreshold`, exclude the deleted block (it was moved, not deleted).
- Return only the surviving deleted blocks.

Export only `filterMoved`.

**Unit tests — add to `src/miner/move-filter.test.ts`:**
- A block deleted in file A and added verbatim in file B within the same commit is excluded.
- A block deleted with no corresponding addition survives.
- A re-indented block (same code, different leading spaces) is excluded when Jaccard ≥ moveThreshold.
- A lightly edited block (a few tokens changed) is excluded when Jaccard ≥ moveThreshold and survives when Jaccard < moveThreshold.
- Two different blocks where only one is moved: only the moved one is excluded.
- With `moveThreshold: 1.0`, only exact fingerprint matches are excluded.

**Property tests:**
1. **Exact move is not a death**: if a deleted block's normalized text exactly equals any added block's normalized text, it must not appear in the output (Jaccard = 1.0 always exceeds any threshold ≤ 1.0).
2. **Indentation-only change is not a death**: a block moved with only leading-whitespace changes has Jaccard ≥ 0.9 and must not appear in the output at the default threshold.
3. **Low similarity survives**: a deleted block with no added content in the commit always survives (Jaccard = 0 against an empty union).

---

## Task 10 — Git log streamer (`src/miner/git-log.ts`)

**File:** `src/miner/git-log.ts`

Implement `spawnGitLog(repo: string, options: Pick<MinerConfig, 'since' | 'until'>): AsyncIterable<RawCommit>`.

- Spawns `git log -p --no-merges --no-color --date=iso-strict` with the sentinel `--format` from design.md.
- Streams stdout line by line using `readline`.
- Yields one `RawCommit` per commit as soon as the sentinel boundary is detected; does not buffer the full output.
- Throws `MinerError` if `git` is not on PATH or the directory is not a git repo.

Export `spawnGitLog` and `MinerError`.

**Unit tests using fixture repos — add to `src/miner/git-log.test.ts`:**

Each test creates a temporary directory, runs `git init` + scripted commits via `child_process.execSync`, then asserts on the yielded `RawCommit` objects.

Fixture scenarios:
1. **Single commit, one deleted line**: yields exactly one `RawCommit` with the correct hash, subject, and a diff containing a deletion.
2. **Multiple commits**: yields them in reverse-chronological order (git default).
3. **Commit with multi-paragraph body**: `body` is captured fully, including newlines.
4. **Commit message with `#123` reference**: `subject` or `body` contains the raw reference text (link parsing is a later step).
5. **`--since` / `--until` filtering**: only commits in the range are yielded.
6. **Empty repo (no commits)**: yields nothing without throwing.
7. **Not a git repo**: throws `MinerError`.

---

## Task 11 — Tombstone builder (`src/miner/build-tombstone.ts`)

**File:** `src/miner/build-tombstone.ts`

Implement `buildTombstone(block: RawBlock, meta: ParsedCommit['meta'], config: MinerConfig): Tombstone | null`.

- Returns `null` if the fingerprint after normalization is empty (block too short).
- Computes `id` as `crypto.createHash('sha1').update(`${meta.hash}:${block.filePath}:${block.hunkStart}`).digest('hex')`.
- Sets `causeOfDeath` to `"cause of death unknown"` if the commit subject is blank.
- Sorts `fingerprint` ascending before storing.

Export only `buildTombstone`.

**Unit tests — add to `src/miner/build-tombstone.test.ts`:**
- Same inputs always produce the same `id`.
- Empty-message commit → `causeOfDeath === "cause of death unknown"`.
- Block too short after normalization → returns `null`.
- `links` is populated from the commit message.
- `fingerprint` is sorted ascending.
- `buriedAt` matches the ISO 8601 date from `meta.authorDate`.

---

## Task 12 — Orchestrator (`src/miner/index.ts`)

**File:** `src/miner/index.ts`

Implement `runIndex(repo: string, config: MinerConfig): Promise<Graveyard>`.

Wire together tasks 7–11 and the new grace/revival modules:
1. Stream commits with `spawnGitLog`.
2. For each commit: `parseDiff` → `extractBlocks` (deleted) + `extractBlocks` (added) → `filterMoved` (Jaccard) → `buildTombstone` per surviving block.
3. Accumulate tombstones in a `Map<string, Tombstone>` for dedup.
4. After each commit, run grace-filter: if any pending tombstone's `buriedAt` is within `config.graceDays` of the current commit date, and the commit's added fingerprints match it at ≥ `config.moveThreshold`, remove that tombstone.
5. Once the grace window for a tombstone has expired, pass it to the revival tracker: for each later commit whose added blocks match the tombstone at ≥ `config.moveThreshold`, append a `RevivalRecord`. If a confirmed tombstone is later deleted again, append a `DeathRecord`.
6. After the stream ends: sort tombstone array by `buriedAt` asc, then `id` asc. Sort `revivals` and `deaths` within each tombstone by `date` asc.
7. Compute `GraveyardStats` using `stats.ts`.
8. Return `{ tombstones, stats }`.

Also export `IndexStats`:
```typescript
export interface IndexStats {
  commitsWalked: number;
  hunksParsed: number;
  blocksFound: number;
  movesExcluded: number;
  graceDropped: number;
  tombstonesAdded: number;
  revivals: number;
}
```

And `runIndexWithStats(repo, config): Promise<{ graveyard: Graveyard, stats: IndexStats }>`.

**Integration test — add to `src/miner/index.test.ts`:**

Using a fixture repo with scripted commits:
1. A block deleted in commit A appears as a tombstone.
2. A block deleted then re-added in the same commit does not appear (move detection).
3. A block deleted in commit A and re-added within 7 days in commit B does not appear (grace period).
4. A block deleted in commit A and re-added after 8+ days in commit B appears as a tombstone with one revival record.
5. Re-indexing the same repo produces identical JSON output (determinism).
6. A block in `node_modules/` is not indexed.
7. A block too short (< `minBlockLines`) is not indexed.

---

## Task 13 — Sorted JSON serializer (`src/miner/serialize.ts`)

**File:** `src/miner/serialize.ts`

Implement `toGraveyardJson(graveyard: Graveyard): string`.

- Serializes the full `Graveyard` object (`{ tombstones, stats }`) with alphabetical key order within every nested object.
- Pretty-prints with 2-space indentation.
- Does not re-sort the tombstone array (caller is responsible for order).

Implement `fromGraveyardJson(json: string): Graveyard` for reading back a written graveyard.

Export both functions.

**Unit tests �� add to `src/miner/serialize.test.ts`:**
- Round-trip: `fromGraveyardJson(toGraveyardJson(graveyard))` deep-equals `graveyard`.
- Keys in output JSON are alphabetically ordered (including inside `stats` and nested records).
- Two calls with the same input produce byte-identical output.
- A graveyard with revivals and deaths round-trips correctly.

---

## Task 14 — CLI `index` command (`src/cli/index-command.ts`)

**File:** `src/cli/index-command.ts`

Wire up the `deja-boo index [repo] [options]` command using Node's built-in `parseArgs` (no commander/yargs dependency).

- Parse all flags from REQ-11 plus `--move-threshold` and `--grace-days`.
- Call `runIndexWithStats`.
- Write output with `toGraveyardJson`; create parent directory if missing.
- Print the summary block from REQ-11 to stdout, extended with:
  ```
  Grace dropped   : 2
  Revivals found  : 4
  ```
- Exit with code 1 and a message on `MinerError`.

**Options (additions to REQ-11 table):**

| Flag | Default | Description |
|---|---|---|
| `--move-threshold <n>` | `0.9` | Jaccard threshold for move detection and grace/revival matching |
| `--grace-days <n>` | `7` | Days after deletion within which a re-add drops the tombstone |

**Integration test — add to `src/cli/index-command.test.ts`:**
- Running the CLI on a fixture repo writes a valid graveyard JSON file containing `tombstones` and `stats` keys, and prints the expected summary lines.
- `--out` to a non-existent directory creates the directory and the file.
- Running on a non-git directory exits with code 1.
- `--grace-days 0` disables the grace period; a block re-added the next day produces a tombstone with a revival record.

---

## Task 15 — Grace filter (`src/miner/grace-filter.ts`)

**File:** `src/miner/grace-filter.ts`

Implement `applyGrace(pendingTombstones: Map<string, Tombstone>, commit: ParsedCommit, config: Pick<MinerConfig, 'graceDays' | 'moveThreshold' | 'kgramSize' | 'windowSize' | 'renameIds' | 'minBlockLines'>): string[]`.

The function returns the ids of tombstones that should be dropped:
1. Extract added blocks from the commit using `extractBlocks`.
2. Build the commit's union added-fingerprint set (same as move-filter).
3. For each pending tombstone whose `buriedAt` is within `graceDays` calendar days of the commit date, compute Jaccard similarity between the tombstone's fingerprint and the union added-fingerprint.
4. If similarity ≥ `moveThreshold`, include the tombstone's id in the returned drop list.

Export only `applyGrace`.

**Unit tests — add to `src/miner/grace-filter.test.ts`:**
- A tombstone re-added 3 days later (within 7-day grace) is dropped.
- A tombstone re-added 10 days later is not dropped.
- A tombstone re-added in a commit with an unrelated block is not dropped.
- With `graceDays: 0`, no tombstone is ever dropped by the grace filter.

**Property tests:**
1. **Grace re-add never creates a tombstone**: if a block is deleted in commit A and re-added (Jaccard ≥ moveThreshold) within graceDays in commit B, the final graveyard contains no tombstone for that block.
2. **Grace boundary is exclusive**: a re-add exactly one day beyond graceDays does not trigger grace removal.

---

## Task 16 — Revival tracker (`src/miner/revival-tracker.ts`)

**File:** `src/miner/revival-tracker.ts`

Implement two functions:

```typescript
function recordRevival(tombstone: Tombstone, commit: ParsedCommit['meta'], similarity: number): void
function recordReDeath(tombstone: Tombstone, block: RawBlock, commit: ParsedCommit['meta'], config: MinerConfig): void
```

`recordRevival` appends a `RevivalRecord` to `tombstone.revivals` (sorted by date asc). Sets `isRevert: true` if `commit.subject` starts with `"Revert"`.

`recordReDeath` appends a `DeathRecord` to `tombstone.deaths` (sorted by date asc). The `similarity` in the death record is the Jaccard similarity between the re-deleted block's fingerprint and the tombstone's original fingerprint.

Export both functions and a higher-level `scanForRevivals(tombstones: Map<string, Tombstone>, commit: ParsedCommit, config: MinerConfig): void` that calls them appropriately by scanning the commit's added and deleted blocks against confirmed tombstones.

**Unit tests — add to `src/miner/revival-tracker.test.ts`:**
- A re-add beyond the grace period appends exactly one revival record with correct fields.
- A commit subject starting with `"Revert"` sets `isRevert: true`.
- A commit subject not starting with `"Revert"` sets `isRevert: false`.
- A subsequent re-deletion after revival appends a death record.
- `revivals` and `deaths` are ordered by date ascending after multiple events.

**Property tests:**
1. **Revivals are always later than the death they refer to**: for every `tombstone`, every entry in `tombstone.revivals` has a `date` strictly after `tombstone.buriedAt`.
2. **Re-deaths are always later than the preceding revival**: if `deaths` is non-empty, `deaths[i].date > revivals[i].date` for each index where both exist.

---

## Task 17 — Graveyard stats (`src/miner/stats.ts`)

**File:** `src/miner/stats.ts`

Implement `computeStats(tombstones: Tombstone[], commitsWalked: number): GraveyardStats`.

- `commits`: `commitsWalked`.
- `tombstones`: `tombstones.length`.
- `revivals`: total `revivals` entries across all tombstones.
- `revivalsViaRevert`: total `revivals` entries with `isRevert: true`.
- `medianRevivalGapDays`: median of `(revival.date − tombstone.buriedAt)` in whole days, over all (tombstone, revival) pairs. `null` if no revivals exist.

For the median, use `Math.floor` for each gap, then standard median (average of two middle values when count is even, rounded to nearest integer using `Math.round`).

Export only `computeStats`.

**Unit tests — add to `src/miner/stats.test.ts`:**
- No tombstones → all counts zero, `medianRevivalGapDays: null`.
- One tombstone, no revivals → `revivals: 0`, `medianRevivalGapDays: null`.
- Two revivals with gaps of 5 and 11 days → `medianRevivalGapDays: 8`.
- `revivalsViaRevert` counts only `isRevert: true` entries.

---

## Task 18 — Property and fixture test coverage audit

**File:** `research/pbt-findings.md` (create if it does not exist)

After all tasks are implemented, run `npm test` and verify:

1. All property tests from Tasks 2–4 and 8–9 pass.
2. All fixture-repo tests from Tasks 10–12 and 14 pass.
3. `npm run build` produces `dist/` with no TypeScript errors.
4. Run `npm test -- --coverage` and confirm `src/core/` has ≥ 90% line coverage.

Document any shrunk counterexamples found during the property test run in `research/pbt-findings.md` with:
- Property name
- Shrunk input
- Observed output vs. expected
- Fix applied (or "open")

---

## Task 19 — Performance smoke test

**File:** `research/perf-smoke.sh`

Write a shell script that:
1. Clones a public repo with > 2,000 commits into a temp directory (e.g., `expressjs/express`).
2. Runs `time deja-boo index <tmp-dir> --out /tmp/graveyard-smoke.json`.
3. Prints the elapsed time and tombstone count.
4. Exits with code 1 if elapsed time > 60 seconds.

This is a manual/CI smoke test, not a Vitest test. Add a note to `README.md` (or create it) documenting how to run it.

---

## Dependency notes

No new npm dependencies are introduced by this spec beyond what is already in the project. The implementation uses only:
- Node.js built-ins: `child_process`, `fs`, `path`, `crypto`, `readline`.
- Already-listed dev deps: `typescript`, `vitest`, `fast-check`.
- No git library, no glob library, no argument-parsing library.
