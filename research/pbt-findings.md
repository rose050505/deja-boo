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
