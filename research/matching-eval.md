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

## 6. Re-run with the shipped miner (2026-11-24, after post-review fixes 5)

These numbers come from the miner as it ships now: punctuation tokens with k = 5, per-language comment syntax, the default skip list (all lock files, legal and credits files, sponsor and contributor data), prose docs excluded, merge artifacts excluded, comment-only blocks dropped, tombstones with fewer than 4 distinct hashes dropped (section 8), moves and reformats dropped by containment, revivals checked against ancestry and counted once per patch (section 9), the parent-tree and same-commit checks relative to the revival's own similarity (section 11), and aliveAtHead. They match the stats strip on the web app, except that the web lists only watched tombstones (see below).

Command, per clone (the reviewer's clones in `probe/repos`, at axios 9f0f4ddf, httpie/cli 5b604c3, express 43fca52d, flask 49943b5a, got c196ad0, requests 3c7baaa0):

    npm run build && node dist/cli/main.js index probe/repos/<repo> --out /tmp/<repo>.json

| Repo | Commits | Tombstones (fixes 4 → 5) | Alive at HEAD (fixes 4 → 5) | Comebacks, events (fixes 4 → 5) | Via Revert (fixes 4 → 5) | Median gap, days (fixes 4 → 5) |
|---|---|---|---|---|---|---|
| axios | 2,082 | 559 → 548 | 98 → 88 | 5 → 4 | 2 → 2 | 14 → 13 |
| httpie/cli | 1,690 | 555 → 555 | 34 → 34 | 0 → 0 | 0 → 0 | none |
| express | 5,701 | 1,176 → 1,176 | 42 → 42 | 13 → 10 | 2 → 2 | 145 → 128 |
| flask | 3,832 | 1,100 → 1,092 | 37 → 37 | 4 → 2 | 0 → 0 | 73 → 95 |
| got | 1,719 | 1,190 → 1,190 | 137 → 137 | 5 → 5 | 0 → 0 | 254 → 254 |
| requests | 4,884 | 589 → 585 | 16 → 16 | 5 → 5 | 3 → 3 | 205 → 205 |
| **total** | **19,908** | **5,169 → 5,146** | **364 → 354** | **32 → 26** | **7 → 7** | |

A comeback is one commit (one patch), however many tombstones it brings back: the fixes-5 miner writes 29 revival records for the 26 comebacks, plus 2 merge-conflict records that are excluded as before. **Of the 26 comebacks, 20 are confirmed real by hand** (labels in `research/labels/`: the reviewer's 50 and 14 rows, and the 21 independently found re-additions), 2 are ambiguous, 4 are false, and none is unlabelled; **all 7 via Revert are real**. Before fixes 5 the same count was 32 comebacks, 20 real, 2 ambiguous, 10 false (`research/results/event-labels-fixes4.txt`, `event-labels-fixes5.txt`). The earlier version of this section and the README said 6 via Revert; the stats of the fixes-4 miner also count 7 (requests has 3, not 2), so the table is corrected here.

The web app lists 4,795 of the 5,146 tombstones: the alive-at-HEAD ones are not watched and not shown, unless their cause of death is a Revert. Its stats strip counts the comebacks of the listed tombstones (20, 7 via Revert) and says that counting all tombstones gives 26. `npm run web:data` re-attached the obituaries already fetched (`<clone>/.deja-boo/obituaries.json`, no new requests); 4 tombstones that carried one are gone with the skip list (axios 1, flask 3: `LICENSE` and `sponsors.json` blocks).

Before post-review fixes 3 the same clones gave 6,301 tombstones, 660 alive, 50 revival records (6 via Revert by the old count). The hand-labelled results are in sections 9 and 11.

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

## 9. Post-review fixes 4: deaths that were not deaths, revivals that were not revivals (2026-11-24)

A reviewer opened every one of the 50 revivals the 11-22 miner reported, in git (`research/labels/revivals-50-hand.jsonl`), and independently searched the same repos for true re-additions (`true-readds-21.jsonl`). Only 20 of the 50 were real (18 distinct events). The 27 false ones were reformats (13), moves or refactors where the code stayed alive (6), common boilerplate written again in another file (4), re-adds on a branch that does not contain the death commit (3) and one duplicate patch. 22 of the 27 had at least 98% of the tombstone's fingerprint still in the tree right after the death commit: the code never died. Of the 21 true re-additions, the old miner found 12.

### Causes and fixes

| Cause | Fix |
|---|---|
| The move and grace filters compared a deleted block with the union of the commit's added blocks of 4 or more lines by **Jaccard**. A block that moves into a larger file, or is re-wrapped into fewer lines, keeps all its k-grams but shares few with the whole (express 347aa56a: Jaccard 0.04, containment 0.88; requests ef8563ab: 0.08 / 1.00; httpie 05db75bd: 0.00 / 1.00, because the 3-line replacement is not a block). | A deleted block is not a death when at least `aliveAfterDeath` (0.97) of its fingerprint is contained in the k-grams of **all** lines the commit adds (any size), or in the **post-commit content** of the files it touches (read with one long-lived `git cat-file --batch`). The grace filter uses the same test for re-adds within 7 days. |
| A revival was recorded even when the code was still in the tree. | A revival candidate is skipped when at least `aliveBeforeRevival` (0.97) of the fingerprint is in the revival commit's **parent tree** (any file), or when the same commit also deletes at least 0.97 of it (a move). |
| A revival needed whole-block Jaccard >= 0.9, so code that came back inside a larger block was missed. | A revival is a window of the tombstone's line count inside one run of added lines (any size) with Jaccard >= 0.9: the same windowed matching as `check`. |
| Re-adds on other branches, cherry-picks and duplicate patches were counted. | A revival is recorded only if `git merge-base --is-ancestor <death> <revival>`. Each record carries a `patchId` (hash of the changed lines without whitespace or line numbers); a tombstone gets one revival per patch, and stats count one revival per patch (an event), however many tombstones it brings back. |
| The comment remover treated `/*` inside a string as a comment opener in every language (flask `.github/workflows/tests.yaml`: `'docs/**'` turned a 64-line tombstone into 4 hashes). | Comment syntax per language: `#` only for Python, Ruby, shell, YAML and TOML; `//` and `/* */` for C-like languages; `<!-- -->` for HTML and Markdown; every marker for unknown files. Quoted strings are skipped. Fingerprints, windows and the HEAD check all use the tombstone's (or file's) language. |

### Why 0.97 and not 0.9 / 0.8

The reviewer proposed 0.9 for the move filter and 0.8 for the parent tree. `research/scripts/label-containment.mjs` measured, for every labelled case, how much of the tombstone was still present (`research/results/label-containment.txt`). The false ones are reformats and moves: 0.96 to 1.00 present after the death, 0.98 to 1.00 in the parent tree. Several real ones are edits that keep most of the code: express de129c28 adds `--no-exit` to four scripts (0.93 present after the death), axios 08119634 renames a type (0.94), requests 24bcb9ea is the Revert of the chunked upload (0.95, because the surviving non-chunked call overlaps it), and requests 087a27ab's re-enabled tests share 0.83 of their k-grams with other tests. At 0.9 / 0.8 all four are lost, among them the 2023 re-landing of the chunked change that the README uses as an example. At 0.97 / 0.97 they are kept, and the reformats and moves still go.

| On the reviewer's labels | Old miner (fixes 3) | 0.9 / 0.8 | **0.97 / 0.97 (shipped)** |
|---|---|---|---|
| Real revival rows kept (of 20) | 18 | 12 | **16** |
| False revival rows dropped (of 27) | 4 | 26 | **26** |
| Ambiguous rows kept (of 3) | 3 | 0 | 1 |
| True re-additions found (of 21) | 12 | 11 | **14** |
| Revivals reported (events) | 44 records | 20 | **32** (35 records) |
| Via Revert | 6 | 6 | **6** |

Measured with `research/scripts/label-eval.py` (outputs in `research/results/label-eval-*.txt`). A row counts as kept when a tombstone buried by the labelled death commit, at the labelled path, has a revival at the labelled commit.

- **The 20 real rows.** 16 kept. Lost: express e66667e4 (`charsetRegExp`, only 10% of it came back in `response.js`, also lost by the old miner) and flask 4f03a769 (3 hashes, dropped by `minHashes` since fixes 3); axios 08119634 → 2a71f49b in `index.d.cts`, the second block of an event whose `index.d.ts` row is kept; and express 1bf2dbb7 → 8420ae93, whose lines are now reported at the earlier commit 3d597a55 ("moved files from lib/express/* to lib/"), which really re-adds the four `path` lines while the parent tree lacks them. So 15 of the 18 real events are reported at the labelled commit, plus that one at an earlier commit.
- **The 27 false rows.** 26 dropped: all 13 reformats, 6 moves, 4 boilerplate, 3 non-ancestors. The one kept is the duplicate patch express 64a9c720: its twin a872f92a (labelled ambiguous) is no longer reported, so 64a9c720 is now the single record of that event.
- **The 21 true re-additions.** 14 found (12 before): new are express 088856c3 and flask 71e10be2, which came back inside larger blocks. Still missed: axios 7fa69152 and express cc56c63f (the labelled death commit moved the code, so it is not a tombstone; the code died later in another commit), axios bdf493cf → abf95418 (still in the parent tree), axios 6b9b05b9, requests e5fc88ad and e9f94e69 (windowed Jaccard 0.72, 0.85 and 0.82 / 0.44: the code came back changed or interleaved with new lines). A first version that also accepted containment >= 0.9 in the added lines of one file found 17 of the 21, but it reported 60 revival events instead of 32, and the extra ones were mostly partial matches inside large test-suite rewrites, so the miner uses windowed Jaccard only.
- **Revivals nobody labelled.** The new miner reports 14 revival records (13 events) that are in neither label file, mostly because windowed matching finds code inside larger blocks. My reading, not a reviewer's: about four look like real re-additions (axios 0c3a1e9f → abf95418 type declarations, got 3a069190 → fb03d84e the hand-written `delay`, got 0a79ccbe → 8cc6e03d, express 1bf2dbb7 → 3d597a55 above); the rest are boilerplate (flask `LICENSE` text copied into examples, got retry defaults), data (axios `docs/data/sponsors.json`) and the express STATUS_CODES table the reviewer called ambiguous. They are listed in `research/results/label-eval-new.txt`. **These need a reviewer's labels before the new revival count can be called precise.**

### Tombstone noise

Share of tombstones whose fingerprint is at least 95% inside the files the death commit touched, after that commit (`research/scripts/tombstone-noise.mjs`, full k-gram sets in each file's language):

| | Tombstones | >= 95% still present | >= 90% |
|---|---|---|---|
| Old miner (fixes 3) | 5,970 | 952 (15.9%) | 1,239 (20.8%) |
| New miner | 5,169 | 100 (1.9%) | 407 (7.9%) |

The reviewer's count on the 6,301-tombstone graveyard was 927 (14.7%). The 100 that remain are between 0.95 and 0.97 on purpose: edits that keep most of a block, like de129c28. The reviewer's 20-tombstone noise sample (8 of 20) is not in `research/labels/`, so it was not re-checked.

### Cost

Indexing reads the touched files after every commit and, for revival candidates only, the parent tree. express (5,701 commits) takes 12 s instead of 1.7 s on this laptop; the six repos in parallel take 4 to 11 s each. The output is deterministic (two runs are byte-identical).

## 10. Agent-style rewrites: an identifier-renamed score (2026-11-24)

The reviewer rewrote 10 tombstones the way an agent does (renaming 2 to 4 identifiers, reordering, partial copies): `check` caught the target in 2 of 10 (0.64 and 0.66; the others scored 0.07 to 0.21). One renamed identifier was caught 8 of 10. Ordinary unrelated edits fired 0 of 10.

**Change.** Each tombstone also gets `idFingerprint`: the same k-gram winnowing after every non-reserved identifier is replaced by `_ID_`. A window's score is `max(raw Jaccard, renamed Jaccard - 0.2)`, and the renamed score counts only on windows whose raw Jaccard is at least 0.3, so some of the tombstone's own k-grams must be in the same place. A hit that only the renamed score raises is reported as `warn`, never `block`, and the report says "with identifiers renamed". The penalty and the floor were chosen from the table below.

`research/scripts/rename-eval.mjs` (output in `research/results/rename-eval.txt`): every watched tombstone with at least 8 lines (1,745) is mutated and scored against itself with the shipped `scoreTombstone`; unrelated pairs are the tombstone against a random tombstone of the same repo in another file. Then 50 random ordinary commits per repo (no Revert or restore in the subject) are replayed like the PreToolUse hook: before = the parent's version of each touched file, after = the commit's version, against the tombstones buried before that commit.

Share of mutated copies at warn (>= 0.5):

| Mutation | n | Raw only (before) | p = 0.1, no floor | p = 0.1, floor 0.2 | p = 0.2, floor 0.2 | **p = 0.2, floor 0.3 (shipped)** |
|---|---|---|---|---|---|---|
| rename 1 identifier | 1,744 | 97.1% | 99.8% | 99.6% | 99.6% | **99.2%** |
| rename 2-4 identifiers | 1,741 | 76.0% | 98.6% | 95.5% | 94.9% | **91.4%** |
| reorder statements (2 swaps) | 1,694 | 94.1% | 96.3% | 96.2% | 95.4% | **95.2%** |
| rename 2-4 + reorder | 1,689 | 59.3% | 89.9% | 86.9% | 80.5% | **76.4%** |
| drop ~20% of lines | 1,740 | 83.6% | 84.9% | 84.9% | 84.0% | **84.0%** |
| unrelated tombstone pairs (false alarms) | 1,745 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** |

| Ordinary commits replayed (504 file writes) | Writes with an alarm | Alarms |
|---|---|---|
| Raw only (before) | 5 (1.0%) | 8 |
| p = 0.1, no floor | 12 (2.4%) | 23 |
| p = 0.1, floor 0.2 | 7 (1.4%) | 17 |
| p = 0.2, floor 0.2 | 6 (1.2%) | 9 |
| **p = 0.2, floor 0.3 (shipped)** | **5 (1.0%)** | **8** |

The shipped setting is the only one that adds no alarm to ordinary commits: its 8 alarms are the same 8 the raw score already gives (similar test cases in express `res.sendFile`, requests `test_requests.py`, a `got` index rewrite). Those 8 existed before this change and are not fixed by it; the earlier estimate of 0.5% per write (section 8) came from a different replay. The false-alarm rate against unrelated tombstones stays 0.0% (no pair of 1,745 at 0.5, so under 0.1%). Renamed-only hits that reached block: 0.

The reviewer's own 10 rewrites are not in `research/labels/`, so their 2-of-10 result was not re-run. The "rename 2-4 identifiers" row is the closest equivalent: 76.0% to 91.4% at warn.

**Cost.** The renamed windows are fingerprinted only where the raw windows already qualify, the hook skips the `before` scoring when the matched window is unchanged on disk, and window fingerprints now reuse per-position minimums. The 4,000-line / 1,500-tombstone hook benchmark (750 tombstones are renamed copies of the file) measures 360 to 450 ms against its 500 ms budget (about 300 ms before this change).

## 11. Post-review fixes 5: comebacks that were not, and the margin (2026-11-24)

The reviewer labelled the 14 revival records the fixes-4 miner reported that were in no label file (`research/labels/revivals-new-hand.jsonl`): 3 real, 1 ambiguous, 10 false. With the earlier files, the fixes-4 miner's 32 comebacks were 20 real, 2 ambiguous, 10 false. Causes of the 10 false, and what changed:

| Cause | Fix | Result |
|---|---|---|
| The "code was still in the parent tree" check was absolute (0.97). The 5 express STATUS_CODES comebacks have 0.94 to 0.96 windowed similarity and 0.96 of the fingerprint in the parent tree. | Relative: reject when the parent tree (or the commit's own deleted lines) holds at least the revival's similarity minus `aliveMargin`. | The 3 express `spec/spec.core.js` rows with a reviewer label (reformat, 2 moves) go. |
| `LICENSE` (flask, 2 comebacks) and `docs/data/sponsors.json` (axios, 1) were tombstones. | Skip list: `LICENSE*`, `LICENCE*`, `COPYING*`, `NOTICE*`, `AUTHORS*`, `CHANGES*`, `sponsors.json`, `contributors.json`. | 23 fewer tombstones, 4 false rows gone. |
| A fake comeback hides a real one (express 1bf2dbb7). | Not fixed. | See below. |

### The margin

`research/scripts/revival-margin.mjs` lists, for every comeback record of a miner run with nothing rejected (`--alive-margin=-1`), the revival's similarity, the share of the fingerprint in the parent tree and in the commit's deleted lines, and the gap (similarity minus the larger share) with the reviewer's verdict (`research/results/revival-margin.txt`). A comeback is rejected when the gap is at most the margin.

| Gap | Rows |
|---|---|
| below 0 | express e6f71f94 (reformat) -0.027, 8a326700 (move) -0.059 |
| 0.000 | express ca3f525f (move), c18c2a8e (boilerplate), 8420ae93 (real, see below), and 8 unlabelled records whose code stayed whole in the tree |
| **0.002** | **requests 24bcb9ea to 26bea1e4: real, the 2023 chunked-upload re-landing** |
| 0.020 | axios 08119634 to c44d2f23 (a second tombstone of the same Revert event the reviewer labelled real through c71811b0) |
| 0.059 and up | every other real row (2a71f49b 0.059, f07f368f 0.069, 8cc6e03d 0.111, 4c61fef1 0.167, abf95418 0.186, ...) |

| On the labels (both revival files, 23 real, 37 false) | fixes 4 (absolute 0.97) | margin 0.02 | **margin 0 (shipped)** |
|---|---|---|---|
| Real rows kept | 19 | 18 | **19** |
| False rows dropped | 26 | 33 | **33** |
| True re-additions found (of 21) | 14 | 14 | **14** |
| Comebacks (events) | 32 | 25 | **26** |
| Hand-confirmed real events | 20 | 19 | **20** |

The proposed 0.02 loses the requests re-landing, the example the README uses, because the surviving non-chunked call in the parent tree overlaps the tombstone at 0.952 against a similarity of 0.955. Every gap above 0.002 and below 0 separates the rows cleanly, so the shipped margin is 0: reject when the parent tree holds at least the revival's own similarity. The cost is one extra record of an event that is already counted (the 0.020 row), not a new event. `--alive-margin` changes it.

### Why express 8420ae93 does not come back

express 3d597a55 ("moved files from lib/express/* to lib/") is still recorded. Its parent 42af4e40 ("Updated connect submodule") deleted all of `lib/express/`, so the parent tree holds 0.000 of the fingerprint: the move is split over two commits and no check on the parent tree sees it. 8420ae93 is not blocked by 3d597a55 being recorded. Its own parent holds 1.000 of the fingerprint, because 3d597a55 put the code into `lib/view/view.js` whether the miner records that commit or not. By the tree criterion nothing was dead at 8420ae93, at any margin, and it stays a lost real row. Recovering it needs a different notion of death (the code left the path it was buried from) or a split-move detector across a commit pair; neither is in this change.

### The rows that remain

Real 19 of 23 (lost: axios 2a71f49b, the second block of an event whose first block is kept; express 8420ae93 above; express e66667e4 and flask 4f03a769 as in section 9). False: 4 of 37 kept: express 3d597a55 (split move), got 30023f73 and fb03d84e (retry defaults, boilerplate), express 64a9c720 (the single record of a duplicate patch). Of the 26 comebacks, 20 are real, 2 ambiguous and 4 false by hand. The count is still not a precision claim for repos nobody labelled.

### Latency of `check` and the hook (large files)

The renamed second pass of section 10 raised the 4,000-line, 1,500-tombstone hook benchmark from about 300 ms to 595 ms on the reviewer's machine. The pass ranked every window sharing 30% of the tombstone's k-grams, which was about 14,000 windows fingerprinted per call here, and each fingerprint is a sort. Now one candidate search serves both passes, windows are skipped when an exact bound on their Jaccard (`I / (|A| + |B| - I)`, with `|B|` counted without sorting) cannot reach warn, the renamed pass computes raw Jaccard lazily in bound order, picks are run-collapsed before sorting, and the prefilter k-gram set reuses the window streams. Same hits: `src/core/windows-bounds.test.ts` compares `scoreTombstone` with a from-scratch reference on random texts with comments and renamed copies.

| `decideHook`, 4,000 lines, 1,500 tombstones, this laptop, alone | before | after |
|---|---|---|
| plain file | 215 ms | about 100 ms |
| file with block comments | 200 ms | about 105 ms |

## Recommendations (sent to Kiro as review comments)

1. Tokenize identifiers, numbers and punctuation separately, with k = 5. Miner and check must share the same tokenizer.
2. `check` uses **windowed Jaccard**. The window is the tombstone's line count, step 1, and the best window wins. It also reports containment as extra evidence, but does not trigger on containment alone: containment of small tombstones inside 40-line writes fired on 35% of writes.
3. At the end of `index`, mark tombstones whose fingerprint is ≥ 80% contained in HEAD's files as `aliveAtHead: true` and never warn on them. This drops 8% of tombstones, and those are the main source of false alarms.
4. Defaults: **warn at 0.5, block at 0.7**. Block only when the cause of death is a Revert or links to an issue/PR.
5. Re-run sections 1–3 after the change and keep this file updated.
