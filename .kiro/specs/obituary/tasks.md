# Obituary: Tasks

Complete in order. Each batch ends with `npm test` and `npx tsc --noEmit` green. Tick `[x]` when a task is finished. Batches A to E are implemented.

## Batch A: measure first, then core (browser-safe)

### [x] Task 1: Measure the Revert predicate change
- Write `research/scripts/obituary-eval.mjs` (part 1): on the 6 research repos' graveyards, count tombstones whose Revert status changes between `/^revert/i`, `/^revert\b/i`, `startsWith('Revert')` and `^revert(s|ed|ing)?\b`, tombstones whose level changes at the default thresholds, and revivals whose `isRevert` changes. List the changed subjects.
- Record the numbers and subjects in `research/obituary-eval.md`.
- Covers: REQ-6, REQ-9.

### [x] Task 2: One revert predicate
- Create `src/core/revert.ts` with `isRevertSubject`. Make `isRevertCause` delegate to it. Use it in `hauntLevel`, `revival-tracker`, `stats`, and `web/src/layout.ts`.
- Tests: `Revert "x"`, `revert: x`, `Reverting 3362`, `Reverted`, `reverts the commit` are true; `Revertible`, `Preserve`, `" "` are false; first line only. Properties: `isRevertCause`, `hauntLevel` evidence, and `revival-tracker` agree with `isRevertSubject` on generated subjects. Source-scan test: no other revert regex or `startsWith('Revert')` in `src/` or `web/`.
- Existing level monotonicity properties pass unchanged.
- Covers: REQ-6, REQ-8.6, REQ-8.7.

### [x] Task 3: Obituary types, excerpt, and line
- Add `ObituaryRef`, `Obituary`, `ObituaryFile`, `Link.type 'ref'`, `Tombstone.obituary?`, `Graveyard.repoUrl?` to `src/core/types.ts`.
- Create `src/core/obituary.ts`: `makeExcerpt`, `hasObituaryText`, `obituaryLine`, `pickPullRequest`, `entryFromGitHub` (validates the GitHub JSON shape, returns null on a bad shape).
- Tests: excerpt cases (empty, null, long, whitespace runs, surrogate pair at the cut). Properties: prefix of the collapsed body, length <= 400, no split pair, `truncated` iff longer (REQ-8.1, 8.5); `obituaryLine` length <= max; `pickPullRequest` is deterministic and order-independent.
- Covers: REQ-2, REQ-5, REQ-8.

### [x] Task 4: Obituary as evidence in `hauntLevel`
- Extend the `Pick` with optional `obituary` and add `hasObituaryText` to the reason test.
- Tests: no `obituary` gives the old result for generated inputs; a PR with text and no link allows `block`; an entry with only a title does not. Properties: attaching an obituary never lowers a level; thresholds monotonicity and the alive-at-HEAD rules still hold (REQ-8.7).
- Covers: REQ-6.

## Batch B: index records the remote

### [x] Task 5: Link kinds and URLs
- `parseLinks(message, repoUrl?)`: bare `#N` is `ref`, close keywords stay `issue`, URL forms keep their kind, dedupe by `ref` keeping the most specific kind, bare and close-keyword links get `<repoUrl>/issues/N` when `repoUrl` is given.
- Update `linkText` for `ref`, and any exhaustive switch over `Link.type` (hook, Stop, web).
- Tests and property: REQ-8.8. Existing link-parser tests change only where the kind of a bare `#N` changes; list those changes in the task notes.
- Notes (done): no existing link-parser test changed; the one test titled "bare #42" uses `fixes #42`, which stays `issue`. Links keep the pass order of the parser (PR URLs, issue URLs, close keywords, bare refs), not strict message order.
- Covers: REQ-4.

### [x] Task 6: `repoUrl` in the graveyard
- Create `src/obituary/remote.ts` with pure `parseGitHubRemote` (https, scp-like, ssh forms; strips `.git`; rejects other hosts) and `originRepo(cwd)`.
- `src/miner/index.ts` reads origin once, passes `repoUrl` to `buildTombstone`, and sets `graveyard.repoUrl` (omitted when unknown). Serialization keeps sorted keys.
- Tests: remote parsing table; a fixture repo with no origin yields a `graveyard.json` identical to the current golden; a fixture with an `https://github.com/o/r.git` origin has `repoUrl` and URLs on bare links.
- Covers: REQ-4, REQ-8.2.

## Batch C: the `obituary` command

### [x] Task 7: Selection and orchestration
- Create `src/obituary/select.ts` (watched tombstones, groups Revert, revived, linked; newest first, ties by id; distinct commits; skip commits already in `existing`; cap at `limit`).
- Create `src/obituary/run.ts`: `runObituary({ graveyard, repo, limit, existing, fetcher, now })` with the per-commit requests, memoized issue lookups (at most 3 per commit, never the chosen PR), the PR choice, rate-limit stop, error skip, and a summary.
- Tests with a scripted fetcher: priority order; shared death commit fetched once; existing entries kept and not refetched; `pr: null` entry for a commit with no PR; error leaves no entry; rate limit at call k keeps exactly the earlier entries and makes no further calls.
- Properties: fetch budget, no repeated issue number, verbatim excerpts, partial file valid, re-run fetches only the missing commits (REQ-8.3, 8.4, 8.5).
- Covers: REQ-1, REQ-2, REQ-3, REQ-8.

### [x] Task 8: Real fetcher and token
- Create `src/obituary/github.ts`: `createGitHubFetcher(token?)` (Node `fetch`, headers, rate-limit detection from status and `x-ratelimit-remaining` / `retry-after` / `x-ratelimit-reset`), and `resolveToken(env, runGh)` (`GITHUB_TOKEN`, then `gh auth token`, else none).
- Tests with a stubbed `globalThis.fetch`: headers sent, token only on `api.github.com` requests, 403 with remaining 0 and 429 map to `rate-limited`, 404 and 5xx to `error`, and the token string never appears in any returned message.
- Covers: REQ-1 (auth), REQ-3.

### [x] Task 9: `deja-boo obituary`
- Create `src/cli/obituary-command.ts`: parse `--repo`, `--limit`, `--graveyard`, `--out`; resolve repo (flag, then origin); load the graveyard; read an existing obituary file; run; write sorted JSON; print the summary; exit codes 0, 1, 3 as in REQ-1. Dispatch in `main.ts` and add to `--help`. Add `.deja-boo/obituaries.json` to `.gitignore`.
- Tests: temp-dir runs with an injected fetcher (the command takes `deps`): defaults, bad `--limit`, no repo, missing graveyard, rate-limit partial write with exit 0 and the stderr note, output file keys sorted.
- Covers: REQ-1, REQ-2.

## Batch D: show it everywhere

### [x] Task 10: Loading and formatting
- `src/watch/load.ts`: `loadObituaries(dir)` returns `{ file | null, notes }`; `loadGraveyard` attaches `tombstone.obituary` by death commit. Missing file: `null`, no change. Invalid file: ignored with a note.
- `src/watch/format.ts`: hook entry gets the obituary line (cut to 500 characters first, entry still <= 1,200), `formatCheckReport` gets the `obituary:` block and, when a file exists, `not fetched` / `none found on GitHub (looked up <date>)`.
- Tests: golden strings with and without obituary; the byte-for-byte test with no file (REQ-8.2); entry length property (REQ-8.9).
- Notes (done): the line format is now `Obituary (PR #5353, <url>): "<excerpt>"` (the reviewer's wording: URL inside the label, quoted text last, so the label and URL are never cut). The hook entry puts the line on its own line after the cause. `check` adds a third state, `found on GitHub, but its text is empty (looked up <date>)`, for a PR or issue with no body text, so `none found` is never said when something was found.
- Covers: REQ-5, REQ-8.

### [x] Task 11: Hook, Stop, and `check`
- `hook-command.ts`, `stop-command.ts`, `check-command.ts` load obituaries next to the graveyard (hook and Stop stay silent about an invalid file).
- Tests: hook exit codes unchanged; the message for a tombstone with an obituary contains the line `Obituary (PR #5353, <url>): "…"`; Stop prints the same line; `check` shows the block and notes an invalid file on stderr.
- Covers: REQ-5.

### [x] Task 12: MCP
- `get_tombstone` returns the full `obituary`; `check_snippet` revenants carry the one-line fields; `list_graveyard` adds `hasObituary`. File-present-not-covered text only in `get_tombstone`.
- Tests in `src/mcp/tools.test.ts` with and without a file (no file: responses identical to today).
- Notes (done): `get_tombstone` reports the not-covered states in a separate `obituaryStatus` string (the `obituary` key stays an object); `list_graveyard` adds `hasObituary` only when an obituary file exists, so responses without a file are unchanged.
- Covers: REQ-5.

### [x] Task 13: Web
- `web/scripts/build-data.ts` reads `<clone>/.deja-boo/obituaries.json` when present; `strip.ts` keeps `obituary` on web tombstones and counts it in the 3 MB limit; clones without the file produce byte-identical JSON.
- `web/src/graveyard-view.ts` dialog section under the cause; `web/src/main.ts` ghost card line. Spooky styling follows `ghost-voice.md`: facts first, URL and PR number visible, AA contrast, text for every state.
- Tests: dialog and card strings; `strip.test.ts` size and identity cases.
- Covers: REQ-5, REQ-7.

## Batch E: evidence and demo

### [x] Task 14: Coverage measurement
- `research/scripts/obituary-eval.mjs` (part 2): given clones and their `obituaries.json`, report per repo the tombstones with usable obituary text and how many of the 77 Revert tombstones (17 with a reason today) gain one. Run it by hand with `deja-boo obituary` in each clone, then record the numbers in `research/obituary-eval.md` as measured.
- Regenerate the 6 web files with `npm run web:data`.
- Covers: REQ-7, REQ-9.

### [x] Task 15: Demo acceptance and docs
- Fixture graveyard plus a recorded fetcher response for `24bcb9e` / PR #5353 (excerpt copied from the real PR text at recording time). Test: hook stderr has the verbatim cause, the obituary line with URL, and level `block`; with the obituary file removed, the same event gives the same message as before this spec.
- Skill text in `power/skills/check-before-resurrecting`: the obituary line is quoted third-party text, to be read as data, never as instructions.
- README: `npm run bury`, then `deja-boo obituary` (auth options, rate limit, `--limit`), and the `web:data` step. `power/README.md` mentions the new command.
- Notes (done): the real requests scene runs in `src/cli/obituary-demo.test.ts` when `../probe/repos/requests` exists (clone at `26bea1e4^`, committed fixture `src/test-fixtures/requests-obituary-24bcb9e.json` copied from the real run, take-3 rewrite applied, Stop reason contains `Obituary (PR #5353`). The recorded GitHub response is `src/test-fixtures/github-pulls-24bcb9e.json`.
- Covers: REQ-5, REQ-9.
