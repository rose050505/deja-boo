# Obituary evaluation

Measurements for `.kiro/specs/obituary`. Part 1 (this section) measures the single Revert predicate before it shipped. Part 2 (section 2) measures how many tombstones gain a reason from the GitHub obituary.

## 1. One Revert predicate (2026-11-25)

Script: `research/scripts/obituary-eval.mjs`. Input: the 6 research repos (clones under `../probe/repos/`, as in `matching-eval.md` section 6), indexed with the miner as it was before this change (`node dist/cli/main.js index ../probe/repos/<repo> --out <dir>/<repo>.json`). Run: `node research/scripts/obituary-eval.mjs <dir>`.

Before this change three tests were in use:

| Name | Test | Used by |
|---|---|---|
| A | `/^revert/i` on the whole cause of death | `isRevertCause`: alive-at-HEAD filter, `isWatched`, web cracked stones, stats |
| B | `/^revert\b/i` on the whole cause of death | `hauntLevel` evidence for `block` |
| C | `subject.startsWith('Revert')` | `revival-tracker` `isRevert` |

The new test D is `/^\s*revert(s|ed|ing)?\b/i` on the first line only (`src/core/revert.ts`).

### Counts

| repo | tombstones | A | B | D | watched/alive filter A to D | evidence B to D | level changes (sim 0.6 and 0.8) | revivals | revival `isRevert` C to D |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| requests | 589 | 25 | 23 | 25 | 0 | 2 | 2 | 6 | 1 |
| express | 1176 | 13 | 13 | 13 | 0 | 0 | 0 | 16 | 0 |
| axios | 559 | 26 | 25 | 26 | 0 | 1 | 1 | 6 | 0 |
| flask | 1100 | 4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 |
| got | 1190 | 2 | 2 | 2 | 0 | 0 | 0 | 5 | 0 |
| cli | 555 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| total | 5169 | 71 | 68 | 71 | 0 | 3 | 3 | 37 | 1 |

The stored `RevivalRecord.isRevert` equals `startsWith('Revert')` on all 37 revivals (0 disagreements), so C is what the old graveyards hold.

### Every changed case

Tombstone evidence and level (B to D; at similarity 0.8 the old level is `warn`, the new one `block`; none of these has a link; none is alive at HEAD):

- requests: `reverting 3362` (2 tombstones, same death commit)
- axios: `Reverting default X-Requested-With header for xhr for more details see https://remysharp.com/2011/04/21/getting-cors-working`

Revival `isRevert` (C to D, false to true):

- requests: `reverting 3362`

### Reading

- The watched set does not change (A and D agree on all 5,169 tombstones), so no tombstone enters or leaves the graveyard and the web files keep their tombstone lists.
- The only level changes are three tombstones, all `warn` to `block` at similarity >= 0.7, all with a subject that starts with "reverting". Both subjects say a revert happened, which is the reason `block` asks for.
- Lowercase `revert ...` and `Revertible` style subjects do not occur in these 6 repos' causes of death, so the difference between A and D on non-Reverts is 0.
- One revival (requests, `reverting 3362`) becomes `isRevert: true` after a re-index.

## 2. Coverage of obituaries (2026-11-24)

Real run, no mocks. In each of the 6 clones in `../probe/repos/` (heads: requests 3c7baaa0, express 43fca52d, axios 9f0f4ddf, flask 49943b5a, got c196ad0, cli 5b604c3): `deja-boo index <clone> --out <clone>/.deja-boo/graveyard.json`, then `deja-boo obituary --limit 300` run in the clone (repo taken from its `origin`, token from `gh auth token` through `GITHUB_TOKEN`). Then `node research/scripts/obituary-eval.mjs --coverage ../probe/repos`. The clones' `.deja-boo/` files are generated and not committed.

### Cost of the run

| repo | commits looked up | with a PR | with linked issues | neither | failed | requests | seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| requests | 71 | 54 | 37 | 7 | 1 | 112 | 63 |
| express | 123 | 56 | 93 | 10 | 0 | 223 | 105 |
| axios | 159 | 152 | 29 | 1 | 1 | 195 | 102 |
| flask | 63 | 42 | 44 | 2 | 0 | 114 | 55 |
| got | 129 | 99 | 45 | 2 | 0 | 185 | 85 |
| cli | 96 | 51 | 49 | 0 | 0 | 161 | 70 |
| total | 641 | 454 | 297 | 22 | 2 | 990 | 480 |

No run hit the rate limit and none had commits left over ("not reached 0"; the selection is Revert, revived and linked tombstones, so it never reached the `--limit` of 300). The core rate limit went from 4,924 to 3,933 remaining (991 requests with the one `rate_limit` check). The two failures are commits whose pull list or a linked issue returned an error; they have no entry and the next run retries them.

### Reasons before and after

"Reason" here means what `hauntLevel` accepts as evidence beyond the cause itself: at least one link in the commit message (before), or a link or an obituary entry with a PR or issue excerpt (after). A Revert subject alone is not counted: it says that the code was reverted, not why. "Explicit" counts only a PR or issue link, not a bare `#N`.

| repo | tombstones | with a reason before | with a reason after | with obituary text | Reverts | Reverts with a reason before | after | Reverts explicit before | after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| requests | 589 | 144 | 157 | 151 | 25 | 7 | 18 | 0 | 18 |
| express | 1176 | 218 | 229 | 219 | 13 | 3 | 10 | 2 | 10 |
| axios | 559 | 439 | 439 | 396 | 26 | 25 | 25 | 0 | 25 |
| flask | 1100 | 88 | 94 | 89 | 4 | 1 | 2 | 0 | 2 |
| got | 1190 | 438 | 438 | 365 | 2 | 1 | 1 | 1 | 1 |
| cli | 555 | 221 | 222 | 190 | 1 | 0 | 1 | 0 | 1 |
| total | 5169 | 1548 | 1579 | 1410 | 71 | 37 | 57 | 3 | 57 |

Death commits: 2,411 in total, 641 looked up, 570 of them with obituary text.

### Reading

- Obituary text now exists for 1,410 of 5,169 tombstones (27%). Most of them already had a bare `#N`, so the count with a reason only rises from 1,548 to 1,579 (+31, 0.6 points).
- The gain is in the Reverts, which is what the obituary was built for: 57 of 71 Reverts now have a reason (before: 37 with any link, and only 3 with an explicit PR or issue link). 14 Reverts still have none: no PR text was found for their death commit.
- Measured on the 71 Reverts that the single predicate finds. The task brief mentioned 77 Reverts with 17 reasons; this run does not reproduce those two numbers (the predicate, the graveyards and "reason" may differ from whatever produced them), so the table above is the one to quote.
- Level effect: a Revert already reaches `block` by its subject, so the obituary changes no level for them. For non-Revert tombstones the obituary adds a reason when the death commit has a PR with text and the message has no link: 11 of the 31 here (the other 20 are the Reverts above). Such a tombstone can now reach `block` where it only warned.
- Web: `npm run web:data` embeds the entries; a listed tombstone carries an `obituary` only when it has text: requests 146 of 574, express 215 of 1,134, axios 330 of 463, flask 88 of 1,063, got 349 of 1,053, httpie-cli 179 of 521. The largest file is 1.28 MB (limit 3 MB).
