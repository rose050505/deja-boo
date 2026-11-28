# Revenant Watch: Tasks

Complete in order. Each batch ends with `npm test` and `npx tsc --noEmit` green. Tick `[x]` when a task is finished.

## Batch A: core (browser-safe)

### [x] Task 1: Configurable thresholds in `hauntLevel`
- Add `Thresholds` and `WatchConfig` to `src/core/types.ts`.
- Add the optional `thresholds` parameter to `hauntLevel` in `src/core/level.ts`. Defaults come from `WARN_THRESHOLD` and `BLOCK_THRESHOLD`.
- Tests: existing level tests pass unchanged. Property: raising `warn` or `block` never raises the level (REQ-8.2). Property: aliveAtHead non-Revert is always `none` at any thresholds (REQ-8.5).
- Covers: REQ-1, REQ-2, REQ-8.

### [x] Task 2: `findRevenants`, `addedLineNumbers`, `acknowledgedIds`
- Create `src/core/watch.ts` with the three pure functions from design.md, plus `RevenantHit`. `findRevenants` takes an optional `added` set and keeps a hit only if at least half of its matched window is added.
- Tests: `addedLineNumbers(x, x)` is empty; inserting k unique non-blank lines marks exactly those k; whitespace-only edits add nothing; the 16-25 window case (revenant sharing lines with live code) is reported; `acknowledgedIds` returns every appended id; hits are sorted deterministically.
- Properties: `similarity` in [0, 1] and identity is 1; embedding a tombstone's lines gives similarity 1 via `matchWindowed`; monotonicity over `findRevenants`; aliveAtHead non-Revert tombstones are never reported (REQ-8.1, 8.2, 8.5).
- Covers: REQ-1, REQ-4 (added lines), REQ-8.

## Batch B: edge helpers and `check`

### [x] Task 3: Loading and formatting
- Create `src/watch/load.ts`: `loadGraveyard(cwd)` and `loadConfig(cwd)` with the validation rules of REQ-2 (return a `notes: string[]` for `check`).
- Create `src/watch/format.ts`: `causeText`, `linkText`, `formatHookMessage` (REQ-5 shape with the matched line range, at most 3 entries, under 1,200 characters each), `formatCheckReport` (REQ-3 fields, 20 deleted lines).
- Tests: temp-dir config cases (missing, invalid JSON, `warn > block`, non-number); golden strings for the hook message, including empty cause (`cause of death unknown`) and no links.
- Covers: REQ-2, REQ-3, REQ-5.

### [x] Task 4: `deja-boo check`
- Create `src/cli/check-command.ts` and dispatch `check` in `src/cli/main.ts` (also update `--help`).
- Exit 0, 1, 2 by highest level; exit 3 when the graveyard is missing; `-` reads stdin; skip-list paths produce no revenants.
- Tests: run `runCheckCommand` against a temp graveyard built from a small fixture, asserting exit codes and that the report has id, commit, date, verbatim cause, deleted lines, line range, similarity, and containment.
- Covers: REQ-3.

## Batch C: hook

### [x] Task 5: `decideHook`
- Create `src/cli/hook-command.ts` with the pure `decideHook`.
- Builds the post-write text (`fs_write` text; `str_replace` applied to the disk file, first or all occurrences; missing file = all lines added), runs `addedLineNumbers`, exits 0 on no added lines, then `findRevenants`.
- Handles `fs_write`, `str_replace`, other tools, skipped paths, invalid events, missing graveyard, and acknowledgement (partial acknowledgement lists only the remaining ids).
- Properties: exit is 0 iff no unacknowledged revenant, else 2; acknowledging every matched id always gives 0 (REQ-8.3, 8.4). Unit tests for each branch in REQ-4.
- Covers: REQ-4, REQ-5, REQ-8.

### [x] Task 6: Hook entry point and latency
- Add `runHookCommand` (stdin to `decideHook`, stderr, `process.exitCode`) and dispatch `hook` in `main.ts`.
- Add a benchmark test: seeded synthetic graveyard with 1,500 tombstones, 300-line write, `decideHook` under 200 ms.
- If the budget is missed, add the exact prefilter described in design.md ("Performance") with a property test that it never changes the hits. There is no candidate cap. If the budget is still missed, report the measured latency and continue.
- Covers: REQ-4 (latency).
- **Measured (Task 6):** the naive path took 27,000 ms for 1,500 tombstones and a 300-line write. Per-width window indexing alone gave 470 ms. The exact prefilter (`candidateKgrams` plus `sharedCount` in `src/core/watch.ts`) brings it to **7 ms**. It skips a tombstone that shares fewer than `warn * |fingerprint|` hashes with the candidate's k-gram set, which is exact because a window's hashes are a subset of the candidate's when the candidate has no block-comment opener (`/*`, `<!--`, `{-`). Equality with the unfiltered path is a property test (comment lines and openers included, two threshold sets).
- **Known miss:** a write that contains a block-comment opener disables the prefilter and takes **~475 ms** with the same graveyard (window indexing only). Reported, not capped, per reviewer decision 2.

## Batch D: MCP

### [x] Task 7: Pure MCP handlers
- Create `src/mcp/tools.ts` with `checkSnippet`, `getTombstone`, `listGraveyard` returning plain objects (REQ-6 fields, `limit` default 20 and cap 100, path filter, unknown id error).
- Tests: unit tests per tool; property: `list_graveyard` output length <= limit and sorted newest first.
- Covers: REQ-6.

### [x] Task 8: MCP server wiring
- Run `npm install @modelcontextprotocol/sdk` (and `zod` only if the SDK needs it) and commit `package.json` and the lockfile.
- Create `src/mcp/server.ts` (stdio, three tools, graveyard read once, stdout used only by the protocol).
- Test: spawn `node dist/mcp/server.js` after build and call the three tools through the SDK client over stdio against a temp graveyard.
- Done: `zod` added as a direct dependency (the SDK lists it as a peer and the server imports it). The test also covers the missing-graveyard error and checks that every stdout line is a JSON-RPC frame.
- Covers: REQ-6.

## Batch E: dogfooding and demo

### [x] Task 9: Dogfood files
- Add `.kiro/hooks/deja-boo-guard.json` and `.kiro/settings/mcp.json` exactly as in REQ-7, and `.deja-boo/config.json` with the default thresholds.
- Add `.deja-boo/graveyard.json` to `.gitignore` and an `npm run bury` script (`npm run build && node dist/cli/main.js index . --out .deja-boo/graveyard.json`). Do not touch the `.kiro/` ignore rule.
- Test: `src/kiro-config.test.ts` parses both `.kiro` files and asserts the shapes.
- Covers: REQ-7.

### [x] Task 10: Demo acceptance test
- Create `src/cli/demo-hook.test.ts`: build the `haunted-http` fixture, index it to `<repo>/.deja-boo/graveyard.json`, and feed event A (renamed native adapter, expect exit 2, the Revert tombstone's id, commit7, verbatim cause and `lines 16-25` in stderr), event B (the HEAD adapter, expect exit 0 and empty stderr) and event C (`str_replace` swapping the manual `else:` branch for the native call, expect exit 2).
- Also spawn `node dist/cli/main.js hook` once with event A to prove the exit code 2 and stderr survive the process boundary.
- Covers: REQ-9.

## Batch F: wrap-up

### [x] Task 11: Docs and measurement note
- Add a short "Using the guard" section to `README.md`: `npm run bury`, `check`, the hook, MCP, the acknowledgement comment, and the config file.
- Append a short section to `research/pbt-findings.md` for any shrunk counterexample found while writing these properties (skip if none).
- Do not change defaults or thresholds. Covers: REQ-2 documentation.

### [x] Task 12: Final verification
- Run `npm run build`, `npm test`, and `npx tsc --noEmit`. Run `npm run bury` and `node dist/cli/main.js check` on one file from this repository to confirm the dogfood loop.
- Report test counts and the measured hook latency in the task notes.
- **Measured (Task 12):** `npm run build`, `npm test` (27 files, 297 tests) and `npx tsc --noEmit` are green. `npm run bury` indexed this repository (17 commits, 4 tombstones). `node dist/cli/main.js check src/cli/hook-command.ts` exits 0; feeding a tombstone's own lines on stdin exits 1 with the full report. `decideHook` on 1,500 tombstones and a 300-line write took 17 ms (200 ms budget).

## Batch G: Stop hook (REQ-10)

### [x] Task 13: Stop hook
- Add `src/cli/stop-command.ts` (`decideStop` plus git edge `gitStopDeps`), dispatch `Stop` events from `deja-boo hook`, loop guard in `.deja-boo/stop-state.json` (gitignored).
- `formatHookEntry` takes an optional file path; no `..` after a cause ending with a period.
- Covers: REQ-10, REQ-5 cosmetic.

### [x] Task 14: Stop hook dogfood and docs
- Second entry in `.kiro/hooks/deja-boo-guard.json`, update `src/kiro-config.test.ts`, README "Using the guard".
- Covers: REQ-10, REQ-7.

### [x] Task 15: Stop hook tests
- `src/cli/stop-command.test.ts` on the `haunted-http` fixture: shell-style edit to the native adapter blocks naming the Revert tombstone; unchanged tree silent; second Stop same session silent; acknowledged silent; trailing-period message.
- Covers: REQ-10.

## Post-review fixes 3

Source: reviewer functional review on three repos the project never tuned on: pallets/click (3,416 commits), psf/black (2,525) and koajs/koa (1,328), full history. Real revert/restore commits and random ordinary commits were replayed through the PreToolUse and Stop hooks. Core result: blocks of 4 or more lines that come back are caught 8 of 9 times, and ordinary writes fire about 1 in 212 (0.5%). Seven defects; the ones in this spec are below (the miner side is in `graveyard-miner/tasks.md`, "Post-review fixes 3").

- [x] **1. Hook latency on large files (must).** One write to click `src/click/core.py` (4,018 lines) took 4.0-5.7 s; black `tests/test_black.py` 14.5 s; a 120k-line file 11.9 s; Stop up to 15.7 s. CPU profile of `check core.py` (4.6 s): `kgramWinnow` 2.5 s, `normalizeBlock` 0.5 s, because `indexWindows` re-normalizes and re-fingerprints every window from scratch for every tombstone width. Fix: normalize and tokenize each line once, hash the token k-grams once, and slide windows over the precomputed hashes; fingerprint only windows that contain a k-gram a tombstone owns. Target: <= 500 ms for a 4,000-line file. Property: the new windowing equals `matchWindowed` on random inputs (comment openers included). Benchmark test next to the 200 ms one.
- [x] **3. Tiny fingerprints fire on idioms (must).** Tombstones with only 1-3 winnowed hashes: click 38, black 32, koa 8. Writing a py2 idiom `try: range_type = xrange ...` into a new file warned (the hook blocked, exit 2) against an unrelated "apply reorder-python-imports" tombstone; black's `include_regex, exclude_regex, extend_exclude_regex, force_exclude_regex,` argument list blocked. 3 of 3 targeted probes were false alarms. Fix: a tombstone is watched only with at least `minHashes` distinct hashes (default 4; `minHashes` in `.deja-boo/config.json`). Measure how many tombstones this drops on the 6 research repos and record it in `research/matching-eval.md`.
- [x] **4. `check` and MCP `check_snippet` alarm on code that is already at HEAD (must).** On unchanged HEAD files: click 17 of 91 files alarm (8 block), koa 31 of 83, black 13 of 400. Cause: there is no `before`, so Revert tombstones alive at HEAD always fire, and code between the alive threshold (0.8) and warn (0.5) fires too. Fix: for a path inside the repo, use HEAD's version of that path as `before`, so only a write that makes a tombstone worse is reported. `check --no-head` keeps the old behaviour.
- [x] **5. Scattered small deletions are out of scope (document).** Real revert/restore commits replayed: 3 of 18 caught. The misses are reverts spread over many 1-3 line hunks (click 0d1b8ea: six hunks of 1-2 lines) and code lost in merge resolution (`--no-merges`, click c52f43c). Documented in the README ("What it can't see"). No merging of same-commit hunks: no cheap, safe way was found without measuring its false-alarm cost first.
- [x] **6. New-user path is broken (should).** `deja-boo index` wrote `graveyard.json` by default but `check` and the hooks read `.deja-boo/graveyard.json`, giving exit 3 "no graveyard". `.kiro/hooks` use the relative `node dist/cli/main.js`, which fails silently (fail open) in other repos. Fix: the hook prints one clear stderr line when the graveyard is missing (still exit 0); the README gets a "Use it on your repo" section (install, `deja-boo index`, copy `power/hooks/`).

Post-review fixes 3 results (measured 2026-11-24 on clones of click, black, koa and the 6 research repos; details in `research/matching-eval.md` section 8):

- Latency: click `core.py` (4,019 lines, 900 tombstones) 4.3 s to 45 ms; black `test_black.py` 3.0 s to 280 ms; the slowest of black's 529 files in `check` 36 s to 357 ms. New `src/core/windows.ts` (per-line normalization once, k-gram hashes once, exact filter on windows that can reach warn). Benchmark tests: 4,000 lines, 1,500 tombstones, with and without block comments, about 300 ms against a 500 ms budget. Properties: every window fingerprint equals `fingerprintLines`; `matchWindowedIndexed` equals `matchWindowed` (with comment openers and closers, 3,000 runs once by hand); with a similarity floor the match is unchanged at or above it. `distinctRecovery` now normalizes the whole file once per call instead of once per tombstone.
- `minHashes`: `findRevenants(..., { minHashes })` and `config.json` `minHashes` (default 4). Property: raising it never adds a hit.
- HEAD as `before`: `check` and `check_snippet` (with a `path`) alarm on 0 of 132 (click), 95 (koa) and 529 (black) unchanged HEAD files, down from 18, 31 and 22.
- Hook with a missing graveyard exits 0 with one stderr line (the Stop hook prints it too). The old "exit 1" decision in "Reviewer decisions" 1 no longer applies to the missing graveyard; a broken event still exits 1.
- Replay of the first 8 to 12 `Revert` commits of click, black and koa: old and new code agree on all 31 (2, 0 and 0 caught). No detection was lost.
- Not done: merging the hunks of one commit (item 5). No false-alarm measurement was made, so it stays out.

## Post-review fixes 4

Source: reviewer hand-checked accuracy review (see `graveyard-miner/tasks.md`, "Post-review fixes 4", for the miner side). Write-time rewrites done the way an agent does them (renaming 2-4 identifiers, reordering, partial): the target tombstone was caught 2 of 10 (0.64 and 0.66; others 0.07-0.21). One renamed identifier: 8 of 10. Ordinary unrelated edits: 0 of 10 alarms, which must stay.

- [x] **5. Identifier-renamed score.** Tombstones get `idFingerprint` (all non-reserved identifiers replaced by `_ID_` before k-gramming, built by the miner; `idFingerprintOf` computes it from `lines` for older graveyards and the web). `scoreTombstone`: per window, `max(raw Jaccard, renamed Jaccard - RENAME_PENALTY)`, the renamed part only on windows whose raw Jaccard is >= `RENAME_RAW_FLOOR`. `RENAME_PENALTY` 0.2 and `RENAME_RAW_FLOOR` 0.3 come from `research/scripts/rename-eval.mjs` (section 10): it is the only measured setting that adds no alarm to 504 replayed ordinary file writes. A hit that only the renamed score raises is `warn`, never `block`; `RevenantHit.renamed`, the hook and `check` text say "with identifiers renamed", MCP `check_snippet` returns `renamed: true`.
- [x] Windows are normalized in the tombstone's language (`CandidateWindows(lines, { language, renameIds })`, `matchWindowedIndexed(..., options)`), matching the miner's per-language fingerprints.
- [x] **7b. Web counts.** The stats strip counted revivals of all tombstones, but the list leaves out tombstones alive at HEAD (13 revivals in the old data). `stats.json` now has `tombstonesShown`, `revivals` (of listed tombstones) and `revivalsAllTombstones`; the strip shows "tombstones listed" and "revivals of listed tombstones" and says how many there are counting all tombstones. Capped web tombstones are re-fingerprinted in their language.
- [x] Latency: the 4,000-line / 1,500-tombstone hook benchmark (750 tombstones are renamed copies) stays under its 500 ms budget (360-450 ms). Renamed windows are fingerprinted only where raw windows qualify; the `before` score is skipped when the matched window is unchanged on disk (exact); window fingerprints reuse per-position window minimums and a typed-array sort.
- [x] Tests: properties for `scoreTombstone` (never below raw at warn; equal to raw with the renamed score off; verbatim lines score 1; 2-4 renamed identifiers reach warn and never block; unrelated code stays below warn), `matchWindowedIndexed` equals `matchWindowed` for every language with and without renaming, `sortedDistinct`, `winnowHashes`, `containedIn`, `kgramSetOfLines`, per-language comments.

Post-review fixes 4 results (`research/matching-eval.md` section 10; 1,745 watched tombstones with >= 8 lines in the 6 research repos; 50 random ordinary commits per repo):

- Share reaching warn: rename 2-4 identifiers 76.0% to 91.4%; rename 2-4 + reorder 59.3% to 76.4%; reorder only 94.1% to 95.2%; rename 1 identifier 97.1% to 99.2%; drop 20% of lines 83.6% to 84.0%.
- False alarms: unrelated tombstone pairs 0.0% before and after (0 of 1,745). Ordinary commits replayed hook-style: 5 of 504 writes with an alarm (8 alarms) before and after; the renamed score adds none. Those 8 raw alarms already existed (similar test cases) and are not fixed here.
- Not re-run: the reviewer's own 10 rewrites (not in `research/labels/`).

## Check feedback (judge review)

- [x] **`check` clean line.** `runCheck` appends one stderr line when there is no revenant (`✓ clean: <path> checked against N tombstones`, with variants for stdin, `--no-head`, skipped path); stdout and exit codes unchanged; hook and Stop do not use it. Test in `check-command.test.ts`.

## Reviewer decisions

1. A missing graveyard or bad event makes the hook exit 1 (fail open). Agreed.
2. The exact prefilter is the plan if the budget is missed. No silent 300-line cap: report the measured latency and continue.
3. `.deja-boo/graveyard.json` is ignored and rebuilt with `npm run bury`. Agreed.
4. `hauntLevel` gets a third `thresholds` parameter. Agreed.

## kiro-packaging (no spec)

- `power/`: `plugin.json`, `mcp.json` (npx from GitHub), skill `check-before-resurrecting`, `README.md`, and `hooks/deja-boo-guard.json` (PreToolUse write + Stop, copied by the user into `.kiro/hooks/`).
- CLI: `deja-boo mcp` starts the MCP server; `prepare` script builds `dist/` on install from GitHub.
- `.kiro/agents/graveyard-keeper.json`: diff review agent (read, shell, @deja-boo; shell limited to `git *` and `node dist/cli/main.js *`).
- Hooks: `test-on-save.json` (PostFileSave), `session-brief.json` (SessionStart). No separate graveyard-refresh Stop hook, and no PostTaskExec hook (bury builds and re-mines, not cheap). `npm run bury` documented in the README.
- Tests: `src/kiro-config.test.ts` covers the new files.
