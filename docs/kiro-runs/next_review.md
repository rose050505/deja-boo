- skip list: `docs/**/*.html` must also match `docs/api.html` (zero intermediate directories). express still yields 194 html tombstones from docs/.
- BUG (integration): `DEFAULT_MINER_CONFIG.skipPatterns` is `[]`, so the CLI never applies `DEFAULT_SKIP_PATTERNS`. On 6 real repos, 20 of 30 sampled revivals were package-lock.json / dist / generated docs / cacert.pem. Wire the defaults; `--skip` should ADD to defaults; add `--no-default-skip`. Add an end-to-end test: running the CLI with defaults on a fixture repo never yields tombstones for lockfiles or dist/.
- Skip list additions: `Pipfile.lock`, `*.pem`, `*.crt`, python vendored `*/packages/` (e.g. requests/packages), prose docs (`*.md`, `*.rst`, `*.txt`) by default with `--include-docs` to opt in.
- Revivals whose commit subject starts with "merge" (conflict-resolution commits) should be flagged `isMergeArtifact: true` and excluded from stats by default.

## Matching is too coarse for `check` (found 11/23 with the demo repo)
Repro: `demo/build_demo_repo.sh` builds `demo/haunted-http` (6 commits, re-enacts requests 2da7fe08 → 24bcb9ea Revert). Index it, then fingerprint a near-copy of the buried `conn.urlopen(..., chunked=chunked)` block where only `raw`→`response`, `chunked=chunked`→`chunked=True` and indentation changed.
- Current pipeline (whitespace tokens, k=7, w=4, Jaccard): similarity **0.25** → would NOT trigger the 0.6 threshold. One-token edits kill every k-gram because `method=request.method,` is a single token.
- Reviewer experiment (scratch script, punctuation-level tokens `[A-Za-z_]\w*|\d+|\S`, k=5): Jaccard **0.84**, containment (|A∩B|/|B|) **0.91**. A genuinely restructured rewrite stays low (0.21 / 0.51), so this does not just inflate everything.
Ask: tokenize identifiers/numbers/punctuation separately in normalize/fingerprint (miner and check must share it), make k default 5, and have `check` report both Jaccard and containment (containment of the tombstone in the candidate). Add a property: renaming one local variable in a ≥10-line block keeps similarity ≥ 0.6. Re-run the 6-repo measurement after the change.

## Measured on 6 repos + demo (11/23 night) — see research/matching-eval.md
Numbers (graveyards with the skip list applied, 7,094 tombstones):
- One renamed identifier: whitespace tokens catch 37% at 0.6; punctuation tokens k=5 catch 85%.
- Dead block embedded in a 40-line write: whole-write Jaccard catches 1.8% at 0.5; windowed Jaccard (window = tombstone line count) catches 85%.
- Demo scene (agent rewrites all of adapter.py): today 0.05 (guard silent); windowed punctuation 0.94.
- 8% of tombstones are still alive at HEAD (reformat / refactor / multi-commit moves; axios 21%, got 14%). They cause almost every false alarm on live code.
Asks (in addition to the two sections above):
1. Shared tokenizer in src/core: identifiers, numbers and single punctuation characters; k=5, w=4. Miner and check use the same function.
2. `matchWindowed(tombstone, candidateLines)`: slide a window of tombstone.lines.length over the candidate (step 1), return the best Jaccard, the matched line range and containment (evidence only; never trigger on containment).
3. At the end of `index`, fingerprint the HEAD tree (same skip list) and set `aliveAtHead: true` on tombstones whose fingerprint is >= 80% contained in it; check ignores them, stats report them.
4. Default levels: warn >= 0.5, block >= 0.7 AND (cause of death is a Revert OR it links an issue/PR); otherwise cap at warn.
5. Properties: renaming one identifier in a >= 10-line block keeps windowed similarity >= 0.6; inserting a tombstone into unrelated lines never lowers its windowed score below the score of the block alone minus 0.05; a tombstone is always aliveAtHead when HEAD contains its lines verbatim.
