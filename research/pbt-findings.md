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
