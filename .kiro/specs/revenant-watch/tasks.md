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
