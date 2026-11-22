# PBT Findings

Property-based test counterexamples found during implementation of Tasks 2–4.

---

## Finding 1 — `normalizeBlock` idempotency: `[" -"]`

**Property:** `normalize(normalize(x)) === normalize(x)` (Tasks 2, Property 1)

**Shrunk input:** `[[" -"]]`

**Observed:** pass 1 → `"-"`, pass 2 → `""` (not equal)

**Cause:** The original diff-prefix strip ran before trimming. `" -"` has a leading space, so the
first-pass strip left it untouched, then step 4 trimmed it to `"-"`. The second pass saw a
bare `-` at position 0 and stripped it to `""`.

**Fix:** Move the diff-prefix strip to after the comment-removal and single-line-comment steps, operating
on the already-trimmed content. Because `removeSingleLineComment` treats `--` as a comment and
removes it first, the edge case of `"--"` is handled before the prefix strip runs.

**Status:** resolved

---

## Finding 2 — `normalizeBlock` idempotency: `["--"]`

**Property:** `normalize(normalize(x)) === normalize(x)` (Tasks 2, Property 1)

**Shrunk input:** `[["--"]]`

**Observed:** pass 1 → `"-"` (strip one `-`, left with bare `-`), pass 2 → `""` (not equal)

**Cause:** The fix for Finding 1 stripped the first `-` in `"--"` before the `--` comment detector
could fire. `removeSingleLineComment` only catches `--` when both dashes are present; after
stripping one, only `"-"` remained, which survived.

**Fix:** Reorder the pipeline: run `removeSingleLineComment` before the diff-prefix strip. `"--"` is
now detected as a Haskell/SQL comment and removed entirely (returns `""`), so the prefix strip
never sees it.

**Status:** resolved

---

## Finding 3 — `normalizeBlock` idempotency: `["-+"]`

**Property:** `normalize(normalize(x)) === normalize(x)` (Tasks 2, Property 1)

**Shrunk input:** `[["-+"]]`

**Observed:** pass 1 → `"+"` (strip leading `-`, leaving `+`), pass 2 → `""` (strip leading `+`)

**Cause:** The diff-prefix strip removed exactly one leading character. A sequence of mixed prefix
characters (`-+`) survived as `+`, which the second pass then stripped.

**Fix:** Strip *all* consecutive leading `-`/`+` characters in one pass (not just one). After this,
the trimmed output never starts with `-` or `+`, making the second application a guaranteed no-op.

**Status:** resolved

---

## Finding 4 — `renameIds` symmetry: `[["0"]]` vs `[["1"]]`

**Property:** blocks differing only in identifier names normalize equally with `renameIds: true`
(Task 2, Property 4)

**Shrunk input:** `[["0"], ["1"]]`

**Observed:** `"0"` and `"1"` normalize to `"0"` and `"1"` respectively (not equal)

**Cause:** The test generator used `fc.hexaString()`, producing strings like `"0"` and `"1"`.
These do not match the identifier regex `[A-Za-z_][A-Za-z0-9_]*` (they start with a digit), so
they are never replaced by `_ID_`.

**Fix:** Changed the test generator to `fc.stringMatching(/^[a-z][a-z]{3,9}$/)` (lowercase
alphabetic names, minimum length 4 to avoid short reserved words) with an explicit filter
against the full reserved-word set.

**Status:** resolved (test fix only; implementation was correct)

---

## Finding 5 — `filterMoved` Property 2: indentation-only change survives when it should not

**Property:** indentation-only change is not a death (Property 2, Task 9 move-filter PBT)

**Shrunk input:** `[["{-  !","! !","! !","! !","! !"]]`

**Observed:** `filterMoved([del], [add], cfg)` returned `[del]` (block survived) instead of `[]` (excluded as a move).

**Cause:** The first line `{-  !` opens a Haskell/Lua block comment `{- -}`. The comment was never closed, so `removeBlockComments` consumed the rest of the block, leaving the normalized content empty. With an empty fingerprint, `kgramWinnow` returns `[]`. `filterMoved` has an early-out: `if (fp.length === 0) return true` (keep the block), so the block is not excluded despite being an exact re-indented copy.

**Fix:** Changed the PBT generator for Properties 1 and 2 from `fc.string().filter(...)` to `fc.stringMatching(/^[a-z]{4} [a-z]{4} [a-z]{4}[a-z]*$/)`. These generated lines always have three or more tokens, never start with comment markers, and always produce non-empty fingerprints at the test's kgramSize of 3.

**Status:** resolved (test generator fix; implementation is correct per spec — empty-fingerprint blocks are intentionally kept and discarded later by build-tombstone)

---

## Finding 6 — `applyGrace` with `graceDays: 0` dropped tombstones on same-day re-add

**Property:** With `graceDays: 0`, no tombstone should ever be dropped by the grace filter.

**Shrunk input:** tombstone buried at `2024-01-01T00:00:00Z`, commit re-adding same lines also on `2024-01-01T00:00:00Z`.

**Observed:** `applyGrace(pending, commit, { ...CFG, graceDays: 0 })` returned the tombstone id (dropped it instead of keeping it).

**Cause:** The boundary check was `daysDiff > config.graceDays`. With `graceDays: 0` and `daysDiff = 0`, the condition `0 > 0` is false, so the check passed through to the similarity test, which matched, and the tombstone was dropped. The intent of `graceDays: 0` is to disable the grace period entirely, not to allow same-millisecond re-adds.

**Fix:** Added an early return when `config.graceDays <= 0`: `if (config.graceDays <= 0) continue;` before the boundary arithmetic. This short-circuits the loop for every tombstone when the grace period is disabled.

**Status:** resolved

---

## Finding 7 — Orchestrator processed commits newest-first; grace and revival tracking were silently wrong

**Property (integration):** A block deleted Jan 5 and re-added Jan 10 (within 7-day grace) must not appear as a tombstone.

**Observed:** The tombstone appeared because the restore commit (Jan 10) was processed before the deletion commit (Jan 5) — git yields commits newest-first.

**Cause:** `spawnGitLog` yields in reverse-chronological order (git default). The orchestrator's grace filter can only drop a tombstone that already exists. With newest-first order, the restore commit arrives before the deletion commit, so the tombstone doesn't exist yet when the restore is processed, and the grace filter never fires. The same ordering bug caused revival records to be missed.

**Fix:** Collect all `RawCommit` objects from the stream into an array, then call `Array.prototype.reverse()` to replay them oldest-first before the main processing loop. This adds O(n) memory for n commits but is well within the 60-second / 5,000-commit performance budget.

**Status:** resolved

---

## Finding 8 — `buildTombstone` with empty-fingerprint blocks: restored generator

**Property:** No tombstone ever has an empty fingerprint.

**Background (Finding 5 context):** The PBT generator for `filterMoved` Properties 1–2 was narrowed to avoid comment-like lines that produce empty fingerprints. This was correct for `filterMoved` (where the spec says keep empty-fp blocks and let `buildTombstone` drop them), but it meant no test actually exercised the "skip empty fingerprint" path in `buildTombstone`.

**Restoration:** Added a new `anyLine` generator in `build-tombstone.test.ts` that deliberately produces comment-only lines, blank lines, single tokens, and other short strings. This generator feeds the new property test: `buildTombstone` with `anyBlock` inputs must either return `null` (empty fingerprint correctly skipped) or return a tombstone whose `fingerprint.length > 0`.

**Property added:** "No tombstone ever has an empty fingerprint" — 500 runs. All pass.

**Status:** resolved (new property test; implementation was correct)

