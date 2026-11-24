# Obituary evaluation

Measurements for `.kiro/specs/obituary`. Part 1 (this section) measures the single Revert predicate before it shipped. Part 2 (coverage of obituaries) is recorded when it is run.

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
