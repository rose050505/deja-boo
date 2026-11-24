Review comments on .kiro/specs/graveyard-miner (please revise requirements.md, design.md and tasks.md accordingly; do not implement yet):

1. REQ-3 blank-line rule is self-contradictory ("blank lines do not break a run" vs "a run ends at a removed line that is blank"). Make it: blank removed lines are skipped (neither counted nor breaking); a run ends at a context or added line.

2. REQ-4 move detection is too strict. Evidence from a probe over 6 public repos (~20k commits): most false "deaths" were (a) blocks re-indented or slightly edited while moved in the same commit and (b) blocks deleted in one commit and re-added a few commits / days later (split refactors). Change to:
   - Same-commit move: fingerprint Jaccard >= 0.9 between the deleted block and the union of added content in that commit (configurable `--move-threshold`).
   - Grace period: if a later commit within `--grace-days` (default 7) re-adds the block (Jaccard >= move threshold), the block was not really dead: drop the tombstone.

3. Add REQ-14 "Historical revivals": when a block is re-added AFTER the grace period, keep the tombstone and append a revival record `{ commit, date, author, subject, similarity }` to `tombstone.revivals[]`. If it is deleted again later, append to `tombstone.deaths[]` (a tombstone can die more than once). Add a summary to the graveyard JSON: `stats: { commits, tombstones, revivals, revivalsViaRevert, medianRevivalGapDays }` (a revert = subject starts with "Revert").

4. Add property tests for 2 and 3: a block moved with only indentation changes never creates a tombstone; a block re-added within the grace period never creates a tombstone; revivals are always later than the death they refer to.
