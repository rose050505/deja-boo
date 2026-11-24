# Matching evaluation: can `check` catch rewritten dead code?

Measured 2026-11-23 by the reviewer (Claude Code) on the graveyards that `deja-boo index` built for 6 public repos (axios, httpie/cli, express, flask, got, requests; 19,908 commits; default skip list + `*.pem`, vendored `packages/`, `docs/*.html`; 7,094 tombstones; the miner has changed since, see section 6). The scripts live in the reviewer's workspace. They import `dist/core` from this repo unchanged, so method A is exactly what ships today. Seeds are fixed, so a re-run gives the same numbers.

`steering/evidence-first.md` says thresholds must come from numbers in `research/`. These are those numbers.

## Methods compared

| | Tokens | k | w | Score |
|---|---|---|---|---|
| **A** (current) | whitespace-separated | 7 | 4 | Jaccard over the whole candidate |
| **B** | identifiers, numbers, single punctuation (`[A-Za-z_]\w*\|\d+\|\S`) | 5 | 4 | Jaccard |
| **C** | same as B | 5 | 4 | containment = \|T ∩ C\| / \|T\| |

## 1. A dead block rewritten the way an agent would

Each of the 2,682 tombstones with at least 8 lines is mutated, then compared with its own original.

| Mutation | A ≥ 0.6 | B ≥ 0.6 | C ≥ 0.6 |
|---|---|---|---|
| reindent only | 100% | 100% | 100% |
| rename one identifier | **37.0%** | **84.8%** | 94.9% |
| change one literal / kwarg value | 77.6% | 99.5% | 99.8% |
| rename + literal + reindent | **29.6%** | **79.9%** | 93.0% |
| drop ~20% of lines | 31.0% | 73.5% | 81.5% |

When the tombstone is paired with an unrelated tombstone from another file, the false-alarm rate is ≤ 0.1% for all three methods.

**Result:** whitespace tokens fail on one-token edits. `method=request.method,` is a single token, so renaming `request` kills every k-gram that touches it.

## 2. The dead block sits inside a larger write

An agent rarely writes only the dead block. Here a renamed tombstone (6–30 lines) is inserted at a random line inside 30 lines of other code from the same repo (851 cases).

| Score over… | Recall ≥ 0.5 | Recall ≥ 0.6 |
|---|---|---|
| the whole write | **1.8%** | 0.7% |
| the best window of the tombstone's line count | **85.1%** | 73.9% |

**Result:** whole-candidate Jaccard dilutes the score with everything else in the write, so it almost never fires. Matching has to be **windowed**: slide a window the size of the tombstone over the candidate lines and keep the best score.

## 3. False alarms on live code, and the "still alive" problem

Each sample is a random 40-line window of a real source file at HEAD, which is the kind of code an agent edits every day. 300 windows (50 per repo) were checked against every non-revived tombstone in the repo with windowed B.

| Threshold | Alarms per write | Writes with ≥ 1 alarm |
|---|---|---|
| 0.5 | 0.15 | 12.0% |
| 0.6 | 0.11 | 8.3% |
| 0.7 | 0.06 | 5.0% |

Minimum tombstone fingerprint size is 10 hashes. With 3 hashes the numbers barely change.

Opening the alarms shows that almost none are random look-alikes. They are tombstones whose code **is still alive at HEAD**: it was reformatted (prettier), refactored, or moved across files over several commits. For example, axios "implement prettier" re-created the same test in a new folder, and got "Refactor" moved code from `index.ts` to `response.ts`.

A tombstone counts as alive at HEAD when at least 80% of its fingerprint occurs in the current tree's fingerprints:

| Repo | Tombstones | Alive at HEAD |
|---|---|---|
| axios | 895 | 188 (21%) |
| got | 1,403 | 193 (14%) |
| httpie/cli | 744 | 54 (7%) |
| express | 1,330 | 51 (4%) |
| requests | 885 | 35 (4%) |
| flask | 1,837 | 60 (3%) |
| **total** | **7,094** | **581 (8%)** |

**Result:** a guard that warns on code that still exists in the repo is wrong by definition. The candidates in the table above *are* live code, so every alarm there is a tombstone that resembles code still in the tree. All 8 alarms we opened by hand were reformat, refactor or move cases.

## 4. The demo scene

`demo/haunted-http` re-enacts requests 2da7fe08 → 24bcb9ea (Revert). In the scene, the agent rewrites the whole `adapter.py` using the pool's native chunked mode, with `raw` renamed to `response` and `chunked=True`.

| Score for the buried block (Revert, 10 lines) | Value |
|---|---|
| A, whole file (what ships today) | **0.05**, so the guard stays silent |
| B, whole file | 0.26 |
| B, windowed | **0.94**, best window at line 15 |

## 5. Which "alive at HEAD" rule? (after post-review fixes 2)

Post-review fixes 2 flagged **both** demo tombstones as alive. The Revert-buried `urlopen(..., chunked=chunked)` block shares more than 80% of its fingerprint with the surviving non-chunked `urlopen(...)` call, so the guard could never fire. Real reverts often look like this, because the reverted variant overlaps with the code that survived.

We compared rules on non-revived tombstones. False alarms are counted per 40-line window of live HEAD code, with windowed Jaccard ≥ 0.6 and 40 windows per repo.

| Repo | No filter | Suppress C80 (≥ 80% of fingerprint anywhere in HEAD) | Suppress W90 (a HEAD window with Jaccard ≥ 0.9) | Suppress C80 **except Reverts** |
|---|---|---|---|---|
| axios | 0.23 | 0.00 | 0.15 | **0.00** |
| httpie/cli | 0.03 | 0.00 | 0.03 | **0.00** |
| express | 0.15 | 0.03 | 0.10 | **0.03** |
| flask | 0.05 | 0.00 | 0.05 | **0.00** |
| got | 0.10 | 0.07 | 0.10 | **0.07** |
| requests | 0.03 | 0.03 | 0.03 | **0.03** |

Exempting Reverts costs nothing: only 84 of 7,052 stones are Reverts. Exempting every stone with an issue/PR link instead brings the noise back, because axios and got put a PR number in almost every subject.

**Rule now in `hauntLevel`:** `aliveAtHead` suppresses a tombstone unless its cause of death is a Revert. With this rule the demo returns `block` at 0.94.

**Known limit:** the guard checks only the lines a write *adds*. Copying the surviving non-chunked call to a new place would still match the Revert stone at about 0.78.

## 6. Re-run with the shipped miner (2026-11-24, after post-review fixes 3)

These numbers come from the miner as it ships now: punctuation tokens with k = 5, the default skip list (now with all lock files), prose docs excluded, merge artifacts excluded, comment-only blocks dropped, tombstones with fewer than 4 distinct hashes dropped (section 8), and aliveAtHead. They match the stats strip on the web app.

| Repo | Commits | Tombstones | Alive at HEAD | Revivals | Via Revert | Median gap (days) |
|---|---|---|---|---|---|---|
| axios | 2,083 | 768 | 227 | 11 | 2 | 73 |
| httpie/cli | 1,690 | 649 | 64 | 3 | 0 | 798 |
| express | 5,701 | 1,332 | 62 | 15 | 2 | 140 |
| flask | 3,832 | 1,202 | 69 | 1 | 0 | 49 |
| got | 1,719 | 1,313 | 192 | 5 | 0 | 84 |
| requests | 4,884 | 706 | 28 | 9 | 2 | 231 |
| **total** | **19,909** | **5,970** | **642** | **44** | **6** | |

Before post-review fixes 3 the same clones gave 6,301 tombstones, 660 alive, 50 revivals (6 via Revert). Axios has one more commit upstream now (2,083 instead of 2,082); it adds no tombstone. Two merge-conflict revivals are excluded. The hand-labelled study (44 revivals, 12 clearly real) was done on the 11-22 miner. It has not been redone for these 44.

## 7. End-to-end on the real history (2026-11-24, Kiro CLI 3.5.0)

The setup is psf/requests checked out at `26bea1e4^` (April 2023, 6,143 commits). The 2020 revert of "Use urllib for chunked requests" is 205 commits back. Kiro was given the prompt *"simplify HTTPAdapter.send(): drop the hand-rolled chunked upload loop and let urllib3 do chunked encoding"*.

| Setup | What happened |
|---|---|
| No guard | Kiro rewrote the exact 2020-reverted code, did not look at history, and reported success |
| PreToolUse write hook only | Same result. Kiro edited through shell commands, so the write hook never ran |
| Write hook + Stop hook (REQ-10) | The Stop guard blocked with the tombstone. Kiro called `get_tombstone`, noted that the revert records no reason, kept the change with `deja-boo: checked a36a5b6…`, and warned to test chunked uploads on the supported urllib3 versions |

In 2023, requests did re-land this change after urllib3 was fixed. The guard did not forbid it. It made the agent check the history and leave a trail.

The guarded outcome is not deterministic. In three more guarded sessions recorded for the demo video (`docs/kiro-runs/video-takes/`), Kiro twice reverted its own change and asked, and once kept it pending, declined to add the marker without a reason, and asked. Every guarded run read the tombstone first; none resurrected the code silently.

## 8. Post-review fixes 3: functional review on click, black and koa (2026-11-24)

A reviewer ran Déjà Boo on three repos it had never been tuned on: pallets/click (3,416 commits), psf/black (2,525) and koajs/koa (1,328), full history. Real revert and restore commits and random ordinary commits were replayed through the PreToolUse and Stop hooks. Core result: blocks of 4 or more lines that come back were caught 8 of 9 times, and ordinary writes fired about 1 in 212 (0.5%). The seven defects found, and what changed, are below. All numbers in this section were re-measured on clones of those repos with the code that ships (old = the commit before the fixes).

**Minimum fingerprint size (`minHashes`, default 4).** Tombstones with 1 to 3 winnowed hashes were click 38, black 32 and koa 8. They are idioms (`try: range_type = xrange`, an argument list) and fired on unrelated code in 3 of 3 targeted probes. The table counts what the new default drops on the 6 research repos. "Items 2 and 7" is the drop from skipping lock files and comment-only blocks, measured with `--min-hashes 0`.

| Repo | Before | Items 2 and 7 only | With `minHashes` 4 | Dropped by `minHashes` |
|---|---|---|---|---|
| axios | 794 | 789 | 768 | 21 |
| httpie/cli | 666 | 666 | 649 | 17 |
| express | 1,407 | 1,375 | 1,332 | 43 |
| flask | 1,356 | 1,262 | 1,202 | 60 |
| got | 1,348 | 1,344 | 1,313 | 31 |
| requests | 730 | 730 | 706 | 24 |
| **total** | **6,301** | **6,166** | **5,970** | **196 (3.2%)** |

The cost is real. Six revivals disappear with the dropped tombstones (50 to 44), none of them via Revert. They belong to five tombstones, and all five are in the hand-labelled sets: 2 were judged *real* re-additions (express `lib/utils.js` e66667e4, flask `src/flask/cli.py` 4f03a769), 1 reformat, 1 move, 1 boilerplate. So the default trades 2 of the 12 clearly real revivals (each a 4 to 5 line block with 3 hashes) for the removal of 3 of 3 false alarms in the reviewer's probes. To keep such tombstones, index with `--min-hashes 1` and set `"minHashes": 1` in `.deja-boo/config.json`. The threshold was set by the reviewer's numbers, not tuned here, and this table is the evidence for it. The false-alarm side was measured only on the reviewer's three probes and on the HEAD sweep below.

**Comment fragments.** A deleted hunk that holds only `*`, `/*`, `*/`, `//` or `#` lines and blanks is no longer a block. The diff's own context tells when a hunk starts inside a `/* ... */`; the lines up to the closer are removed. Effect: axios 4, express 32, got 4, koa 3 tombstones fewer (click, black, flask, httpie, requests: 0). The koa JSDoc probe (`Return request header. / @return {Object} / @api public`) now exits 0.

**Lock files.** `*.lock`, `uv.lock`, `bun.lock`, `bun.lockb` and the other lock files are skipped. Effect: click 35, flask 94 and axios 1 tombstones fewer.

**`check` against HEAD.** For a path inside the repo, `check` and MCP `check_snippet` compare the new text with HEAD's version of the same file, so only what the write makes worse is reported (`check --no-head` keeps the old behaviour). Every tracked, non-skipped file at HEAD checked against the graveyard of its own repo:

| Repo | Files | Alarms before (warn + block) | After |
|---|---|---|---|
| click | 132 | 18 (10 + 8) | 0 |
| koa | 95 | 31 (29 + 2) | 0 |
| black | 529 | 22 (18 + 4) | 0 |

**Large-file latency.** `findRevenants` called once per file; "before" is the old windowing, which re-normalized and re-fingerprinted every window for every tombstone width. Now each line is normalized once and each token k-gram hashed once, and only windows that contain enough of a tombstone's hashes are fingerprinted (an exact filter: the result is unchanged, a property test compares it with the old windowing). Timings on this machine, click graveyard (900 tombstones), no `before`:

| File | Lines | Before | After |
|---|---|---|---|
| click `src/click/core.py` | 4,019 | 4.3 s | 45 ms |
| black `tests/test_black.py` | 4,677 | 3.0 s | 280 ms |
| koa, express and axios `lib/` concatenated (380 block comments) | 14,664 | 3.9 s | 420 ms |
| black, click and flask Python sources, repeated 8 times | 332,465 | not measured | 5.4 s |
| slowest of black's 529 tracked files (`check`, one file) | | 36 s | 357 ms |

The benchmark test in `src/cli/hook-command.test.ts` writes a 4,000-line file with 1,500 tombstones (half of them cut from the file itself) and budgets 500 ms for the whole hook decision; it measured about 300 ms with and without block comments.

**Revert replay (regression check).** The first 8 to 12 revert commits of click, black and koa were replayed with a graveyard mined up to the parent commit and the pre-/post-revert file as before/after. Old and new code agree on all 31: 2 of 12 (click), 0 of 11 (black), 0 of 8 (koa) are caught. No detection was lost. The misses are what the README calls out of scope: reverts that touch many 1 to 3 line hunks, and code lost in merge resolution.

## Recommendations (sent to Kiro as review comments)

1. Tokenize identifiers, numbers and punctuation separately, with k = 5. Miner and check must share the same tokenizer.
2. `check` uses **windowed Jaccard**. The window is the tombstone's line count, step 1, and the best window wins. It also reports containment as extra evidence, but does not trigger on containment alone: containment of small tombstones inside 40-line writes fired on 35% of writes.
3. At the end of `index`, mark tombstones whose fingerprint is ≥ 80% contained in HEAD's files as `aliveAtHead: true` and never warn on them. This drops 8% of tombstones, and those are the main source of false alarms.
4. Defaults: **warn at 0.5, block at 0.7**. Block only when the cause of death is a Revert or links to an issue/PR.
5. Re-run sections 1–3 after the change and keep this file updated.
