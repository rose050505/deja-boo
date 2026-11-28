# Graveyard Miner — Tasks

## Post-review fixes (smoke test on expressjs/express, 5,701 commits)

### Fix 1 — Revival-before-death bug ✅
**Root cause:** revivals were dated from `%aI` (author date). Branches make author dates non-monotonic — a commit authored weeks ago can be merged today, producing a revival timestamp that precedes the tombstone's burial date.

**Fix:** added `committerTimestamp: number` (`%ct`) to `RawCommit` and `ParsedCommit.meta`; switched `git log` to `--reverse --topo-order`; all date arithmetic (grace window, revival date, re-death date, stats gap) now uses `committerTimestamp`. `buriedAtTimestamp: number` added to `Tombstone` for the same reason. `authorDate` is kept as display-only metadata. Added fixture-repo test with a merged side branch whose author dates go backwards, and a fast-check property that generates non-monotonic author dates.

### Fix 2 — CLI entry point ✅
Created `src/cli/main.ts` with shebang, `--help`, and subcommand dispatch (`index` now; `check`/`hook` reserved). Added `"bin": { "deja-boo": "dist/cli/main.js" }` to `package.json`. `node dist/cli/main.js index . --out /tmp/dejaboo-self.json` works after `npm run build`.

### Fix 3 — Default skip list additions ✅
Added `CHANGELOG*`, `HISTORY*`, `*.snap`, and `docs/**/*.html` to `DEFAULT_SKIP_PATTERNS` in `parse-diff.ts`. Updated `shouldSkip` glob handling to support `**` (matches across path separators).

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

## Task 5 — Language detection (`src/miner/language.ts`) ✅

**File:** `src/miner/language.ts`

Implement `detectLanguage(filePath: string): string` using the lookup table from REQ-8.

Export only `detectLanguage`.

**Unit tests — add to `src/miner/language.test.ts`:**
- Each row in the REQ-8 table has a passing test case.
- An unknown extension returns `'unknown'`.
- Path with multiple dots (e.g., `foo.test.ts`) returns `'typescript'`.

---

## Task 6 — Link parser (`src/miner/link-parser.ts`) ✅

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

## Task 7 — Diff parser (`src/miner/parse-diff.ts`) ✅

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

## Task 8 — Block extractor (`src/miner/block-extract.ts`) ✅

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

## Task 9 — Move filter (`src/miner/move-filter.ts`) ✅

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

## Task 10 — Git log streamer (`src/miner/git-log.ts`) ✅

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

## Task 11 — Tombstone builder (`src/miner/build-tombstone.ts`) ✅

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

## Task 12 — Orchestrator (`src/miner/index.ts`) ✅

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

## Task 13 — Sorted JSON serializer (`src/miner/serialize.ts`) ✅

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

## Task 14 — CLI `index` command (`src/cli/index-command.ts`) ✅

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

## Task 15 — Grace filter (`src/miner/grace-filter.ts`) ✅

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

## Task 16 — Revival tracker (`src/miner/revival-tracker.ts`) ✅

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

## Task 17 — Graveyard stats (`src/miner/stats.ts`) ✅

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

## Post-review fixes 2

Source: reviewer comments and `research/matching-eval.md`.

- [x] Skip list moved to `src/core/skip.ts` (pure). `docs/**/*.html` matches `docs/api.html`; binary extensions are now `*.ext` globs (the bare `.png` form never matched); added `Pipfile.lock`, `*.pem`, `*.crt`, `*/packages/`; prose docs `*.md`, `*.rst`, `*.txt` skipped unless `--include-docs`.
- [x] `DEFAULT_MINER_CONFIG.skipPatterns` now holds the defaults. CLI: `--skip` adds, `--no-default-skip` disables, `--include-docs` opts in. End-to-end test on a fixture repo: lockfiles, `dist/`, generated docs, certs and vendored `packages/` yield no tombstones.
- [x] `RevivalRecord.isMergeArtifact` (subject starts with "merge", case-insensitive); excluded from `stats.revivals`, counted in `stats.mergeArtifactRevivals`.
- [x] Shared tokenizer `src/core/tokenize.ts` (identifiers, numbers, single punctuation); `kgramWinnow` uses it; default k = 5, w = 4.
- [x] `matchWindowed`, `containment`, `fingerprintLines` in `src/core/match.ts`; containment is evidence only.
- [x] `aliveAtHead`: `src/miner/head-tree.ts` fingerprints the HEAD tree with the same skip list; tombstones >= 80% contained are flagged; stats count them.
- [x] `src/core/level.ts`: warn >= 0.5, block >= 0.7 only with a Revert or issue/PR link, never for `aliveAtHead`.
- [x] Properties: one-identifier rename keeps windowed similarity >= 0.6; embedding never lowers the score by more than 0.05; verbatim HEAD content is always alive.
- [x] `hauntLevel`: `aliveAtHead` suppresses only non-Revert tombstones (cause starts with "Revert", case-insensitive); Reverts are judged by similarity. `stats.aliveAtHeadReverts` counts them; `aliveAtHead` itself is unchanged. Properties plus a `haunted-http` fixture test (`src/test-fixtures/haunted-http.sh`): 2 tombstones, 1 Revert revival, renamed re-landing yields `block`.
- [ ] Re-run the 6-repo measurement (sections 1-3 of `research/matching-eval.md`) with the new code. Not done here: the reviewer's scripts and repo checkouts are not in this workspace.

---

## Post-review fixes 3

Source: reviewer functional review on pallets/click (3,416 commits), psf/black (2,525) and koajs/koa (1,328); see `revenant-watch/tasks.md` for the full numbers. Items that change the miner:

- [x] **2. Comment fragments matched as code (must).** In koa, a new file containing only a common JSDoc block (`Return request header. / @return {Object} / @api public`) was blocked with similarity 1.00 against c699c75, and `check` on the unchanged `lib/request.js` also blocked. Cause: when the deleted hunk does not include the opening `/*`, the comment interior is normalized as code. Fix: drop deleted blocks whose lines are all comment-like (`*`, `/*`, `*/`, `//`, `#` lines and blank). The diff's own context lines tell whether a hunk starts inside a block comment, and that is used when the opener is in the context (no extra git calls). Property: a block made only of comment lines never becomes a tombstone.
- [x] **3. Tiny fingerprints fire on idioms (must).** Tombstones with 1-3 winnowed hashes: click 38, black 32, koa 8. Fix: `MinerConfig.minHashes` (default 4, `--min-hashes`); `buildTombstone` returns null below it. The watcher applies the same minimum to graveyards that were built earlier. Measure the drop on the 6 research repos.
- [x] **6. New-user path (should).** `deja-boo index` writes `<repo>/.deja-boo/graveyard.json` by default (creates the directory), the path `check`, the hooks and the MCP server read.
- [x] **7. Lock files not skipped (should).** click has 35 `uv.lock` tombstones; replaying a2b9b2f2 (a `uv.lock` write) warned (exit 2) and Stop blocked. Added `*.lock`, `uv.lock`, `bun.lock`, `bun.lockb`, `poetry.lock`, `Cargo.lock`, `Gemfile.lock`, `composer.lock`, `pnpm-lock.yaml` to the default skip list.

Post-review fixes 3 results (6 research repos, miner before vs after; `research/matching-eval.md` sections 6 and 8):

- Tombstones 6,301 to 5,970 (-331): lock files -95 (flask 94, axios 1), comment-only blocks -40 (express 32, axios 4, got 4), `minHashes` 4 -196 (3.2% of 6,166). On the review repos: click 900 to 831 (35 lock files, 34 tiny), black 919 to 891 (28 tiny), koa 419 to 408 (3 comment-only, 8 tiny).
- Revivals 50 to 44 (still 6 via Revert), alive at HEAD 660 to 642, commits 19,908 to 19,909 (one new axios commit upstream). The six lost revivals sit on five tombstones with 1 to 3 hashes; two of them were hand-labelled "real". Recorded as the cost of the default in the README and research.
- `web/public/graveyards/*.json`, `index.json` and `stats.json` were regenerated with `npm run web:data` because the counts changed; the JSON format did not.
- `index` stats line "Skipped empty" is now "Skipped tiny" and counts blocks with fewer than `minHashes` hashes as well. New tests: `comment.test.ts`, `block-extract` (comment-only blocks and hunks that start inside a comment), `parse-diff` (comment context), `build-tombstone` (`minHashes`), `skip` (lock files), `index-command` (default output path, `--min-hashes`, JSDoc and lock file end to end).

---

## Post-review fixes 4

Source: reviewer hand-checked accuracy review of the miner and matcher. Every reported revival was opened in git (`research/labels/revivals-50-hand.jsonl`): 20 of 50 real (18 events); 27 false (13 reformats, 6 moves or refactors, 4 boilerplate, 3 non-ancestor branches, 1 duplicate patch). Tombstone noise in a 20-tombstone sample: 8 of 20. Revival recall: 12 of 21 independently found re-additions (`true-readds-21.jsonl`). The matcher side (fix 5) is in `revenant-watch/tasks.md`.

- [x] **1. Move and grace filters by containment.** `filterMoved` and `applyGrace` compared a deleted block with the union of the commit's added blocks of >= 4 lines by Jaccard (express 347aa56a: 0.04 / containment 0.88; requests ef8563ab: 0.08 / 1.00; httpie 05db75bd: 0.00 / 1.00, the replacement is 3 lines). Now a deleted block is dropped when at least `aliveAfterDeath` of its fingerprint is contained in the k-grams of **all** lines the commit adds (any run size, `commit-grams.ts`) or of the **post-commit content** of the touched files (`repo-reader.ts`, one long-lived `git cat-file --batch`). Grace uses the same test.
- [x] **2. A revival needs the code to have been dead.** `runIndex` skips a candidate when at least `aliveBeforeRevival` of the fingerprint is in the revival commit's parent tree (any tracked, non-skipped file), or when the same commit deletes at least `aliveAfterDeath` of it (a move). Counted in `IndexStats.revivalsNotDead`.
- [x] **3. Revival match by window.** `findRevivalCandidates`: a window of the tombstone's line count inside one run of added lines (any size) with Jaccard >= `moveThreshold` (0.9), the same windowed matching as `check` (`matchWindowedIndexed`, in the tombstone's language). Containment >= 0.9 alone was measured and rejected: 60 events instead of 32 for 3 more true re-additions, mostly partial matches in test-suite rewrites (research section 9).
- [x] **4. Ancestry and duplicates.** A revival is recorded only if `git merge-base --is-ancestor <death> <revival>` (`IndexStats.revivalsNotAncestor`). `RevivalRecord.patchId` (changed lines without whitespace and line numbers, per file) gives one revival per (tombstone, patch); `computeStats` counts one revival per patch (an event), with the smallest gap.
- [x] **6. Comment syntax per language.** `normalizeBlock(lines, { renameIds, language })`, `commentSyntax(language)`: `#` only for Python, Ruby, shell, YAML, TOML; `//` and `/* */` for C-like; `<!-- -->` for HTML and Markdown; all markers for unknown. Quoted strings are skipped for block openers too (flask `tests.yaml` `'docs/**'`). `detectLanguage` knows `.yml`, `.yaml`, `.toml`, `.css`, `.scss`, `.html`, `.sql`. Tombstone fingerprints, revival windows, the move filter and `aliveAtHead` use the file's language; `aliveAtHead` now compares with the full k-gram sets of HEAD files instead of their winnowed fingerprints.
- [x] **7a. `--grace-days` help.** The help said 5, the code uses 7. All numeric defaults in `deja-boo --help` now come from `DEFAULT_MINER_CONFIG`.
- [x] **Thresholds measured, not guessed.** The reviewer proposed 0.9 (move) and 0.8 (parent tree). `research/scripts/label-containment.mjs` on every labelled case: false ones keep 0.96-1.00 of the fingerprint, several real ones are edits that keep 0.93-0.95 (express de129c28 `--no-exit`, axios 08119634, the requests 24bcb9ea Revert, requests 087a27ab at 0.83 in the parent tree). Defaults `aliveAfterDeath` 0.97 and `aliveBeforeRevival` 0.97 (`--alive-after-death`, `--alive-before-revival`). With 0.9 / 0.8 the miner keeps 12 of the 20 real rows and loses the 2023 requests re-landing; with 0.97 / 0.97 it keeps 16.
- [x] Tests: `move-filter` (containment, larger block, re-wrap shorter than a block, post-commit content, one-flag edit survives), `index` (re-wrap, move into a larger block, code back inside a larger block, revival while still in the tree, non-ancestor branch), `revival-tracker` (candidate inside any larger block, move excluded, same patch once), `commit-grams` (properties), `stats` (one revival per event), core properties in `src/core/post-review-4.test.ts`. PBT found `commentSyntax("valueOf")` returning a prototype function (`research/pbt-findings.md` finding 10).

Post-review fixes 4 results (6 research repos, same clones, old = fixes 3; `research/matching-eval.md` sections 6 and 9):

- Tombstones 5,970 to 5,169; alive at HEAD 642 to 364; revivals 44 records to 32 events (35 records), via Revert 6 to 6. Tombstones with >= 95% of the fingerprint still in the touched files after the death commit: 952 (15.9%) to 100 (1.9%).
- Reviewer labels: real rows kept 18 to 16 of 20 (15 of 18 events at the labelled commit, one more at an earlier commit that really re-adds the lines); false rows dropped 4 to 26 of 27; true re-additions found 12 to 14 of 21. 14 revival records (13 events) are not labelled; my reading is about four real, the rest boilerplate, data and an ambiguous table. They need labels.
- Index time: express 1.7 s to 12 s (reading post-commit files and, for candidates, parent trees). Output stays byte-identical across runs.
- `web/public/graveyards/*.json` and `stats.json` regenerated with `npm run web:data`.

## Post-review fixes 5

Source: reviewer's second hand-labelling pass on the revivals the fixes-4 miner reports (`research/labels/revivals-new-hand.jsonl`, plus `revivals-50-hand.jsonl` and `true-readds-21.jsonl`). The 32 events were 20 real, 2 ambiguous, 10 false. Three causes remained, plus wording and a latency regression.

- [x] **1. Parent-tree check is relative.** A revival is rejected when the share of the tombstone's fingerprint in the revival commit's parent tree is at least the revival's own similarity minus `aliveMargin` (replaces `aliveBeforeRevival` 0.97; `--alive-margin`). The same rule replaces the absolute `aliveAfterDeath` test of the same-commit move check in `findRevivalCandidates`. Margin measured on the labels (`research/scripts/revival-margin.mjs`, `research/results/revival-margin.txt`): the real requests 24bcb9ea to 26bea1e4 re-landing (the README's example) has similarity 0.955 and 0.952 in the parent tree, a gap of 0.002, so the proposed 0.02 loses it (real kept 18 of 23 instead of 19). Every false express STATUS_CODES revival has a gap of 0.000 or less. Default 0, rejecting when the parent holds at least the revival's similarity. Tests: `index.test.ts` (same share rejected, lesser share kept, margin loosens).
- [x] **2. A fake revival hides a real one: not fixed by (1), explained.** express 3d597a55 stays recorded: its parent 42af4e40 deleted all of `lib/express/` and 3d597a55 re-added it under `lib/`, so the parent tree holds 0.000 of the fingerprint and no parent-tree rule can see the move. 8420ae93 does not come back either, and removing 3d597a55 would not change that: the parent of 8420ae93 holds 1.000 of the fingerprint (the code was moved into `lib/view/view.js` by 3d597a55 whether or not that commit is recorded), so by the tree criterion nothing was dead at 8420ae93. Both rows stay as measured; the reviewer's label for 8420ae93 asks for a death notion (the code left the path it was buried from) that the miner does not have.
- [x] **3. Skip list.** Added `LICENSE*`, `LICENCE*`, `COPYING*`, `NOTICE*`, `AUTHORS*`, `CHANGES*` (`CHANGELOG*`, `HISTORY*` were there), `sponsors.json`, `contributors.json` (basenames, any depth). Dropped 23 tombstones on the 6 research repos (axios 11, flask 8, requests 4) and with them 4 false revival rows: flask `LICENSE` (2 events), axios `docs/data/sponsors.json` (1 event, 2 rows). Test: `skip.test.ts`.
- [x] **4. Wording.** README and research count events, not records, and say how many are hand-confirmed.
- [x] **5. Latency regression (must).** The large-file benchmark (4,000 lines, 1,500 tombstones) was 595 ms alone for the reviewer; here 215 ms plain and 200 ms with block comments before, about 100 ms and 105 ms now, same results (an exhaustive-definition property test in `windows-bounds.test.ts` compares `scoreTombstone` with a from-scratch reference). Profile of `decideHook` (CPU profile, no obituary or graveyard loading in the call): the identifier-renamed pass ranked every window with at least 30% shared k-grams by raw Jaccard, so it fingerprinted about 14,000 windows per call, and each fingerprint sorted its window picks. Changes, none of which changes a hit:
  - one `candidateBounds` search serves both passes (raw >= warn and raw >= rawFloor), with each window's shared count;
  - an exact upper bound per window, `I / (|A| + |B| - I)` with `|B|` the window's distinct pick count (`fingerprintSize`, computed from run counts without sorting): windows that cannot reach warn are not fingerprinted in pass 1, and the renamed pass computes raw Jaccard lazily in bound order, stopping when the best computed window beats every bound left (same order as the full ranking, ties included);
  - window picks are collapsed by runs before sorting (2.5 times fewer values);
  - the k-gram prefilter set comes from the window streams instead of normalizing the whole text again; seam hashes are computed without allocating; the "window unchanged on disk" test uses a line index instead of a substring search over the whole file.
  The test and its 500 ms budget are unchanged.

Post-review fixes 5 results (reviewer's clones in `probe/repos`, same commits as section 6 of `research/matching-eval.md`; fixes-4 miner vs fixes-5 miner, `research/results/label-eval-*.txt`, `event-labels-*.txt`):

| | fixes 4 | fixes 5 |
|---|---|---|
| Revival events (comebacks) | 32 | 26 |
| Hand-confirmed real events | 20 | 20 |
| Ambiguous / false events | 2 / 10 | 2 / 4 |
| Via Revert (all real) | 7 | 7 |
| Real rows kept, both revival files | 19 of 23 | 19 of 23 |
| False rows dropped, both revival files | 26 of 37 | 33 of 37 |
| True re-additions found | 14 of 21 | 14 of 21 |

Per label file: `revivals-50-hand.jsonl` real 16/20 and false 26/27 (unchanged); `revivals-new-hand.jsonl` real 3/3, false 0/10 to 7/10, ambiguous 1/1. The four false rows left: express 3d597a55 (split move, item 2), got 30023f73 and fb03d84e (retry defaults, boilerplate) and express 64a9c720 (the single record of a duplicate patch). Revival records 35 to 29. The reviewer counted 6 events via Revert; the stats of both miners count 7 (axios d660e29c and c44d2f23, express 140efb57 and c3bd65ed, requests 780ce390, d7f56ba9 and 24bcb9ea), all labelled real.

---

## Index summary (judge review)

- [x] **Comebacks and next step.** After the counters, `index` prints up to 5 comebacks (path, death date, first cause line, reviving commit and date), newest first, or "No comebacks found in history."; then the `Next:` line (REQ-15). Add the "view it" part in the same batch as haunted-graveyard H1.
  Note: `src/cli/comebacks.ts` (one comeback per patch, merge artifacts left out, newest first, "via Revert"), printed after the unchanged counters; tests in `comebacks.test.ts`; "view it" is true now that H1 exists.

---

## Dependency notes

No new npm dependencies are introduced by this spec beyond what is already in the project. The implementation uses only:
- Node.js built-ins: `child_process`, `fs`, `path`, `crypto`, `readline`.
- Already-listed dev deps: `typescript`, `vitest`, `fast-check`.
- No git library, no glob library, no argument-parsing library.
