Reviewer: one more case for the hook's "this write makes it worse" rule, found on the REAL history the demo re-enacts.

Repro: clone psf/requests, check out 26bea1e4^ (2023-04-21, 6,143 commits, the Revert of "Use urllib for chunked requests" is 3 years and 205 commits back), `deja-boo index .`, then feed the hook an fs_write of requests/adapters.py with the content of 26bea1e4 (the real re-landing, "Use urllib3 native chunking ability (#6226)"). Result: exit 0.
Why: the Revert tombstone a36a5b61 (13 lines, `resp = conn.urlopen(... chunked=chunked)`) differs from the surviving non-chunked call by ONE line, so s_before = 0.90 and s_after = 0.95: below the +0.1 margin. Real reverts often differ from live code by a single decisive line.
Measured fix (reviewer scratch script, kgramHashSet over normalized text, k=5):
- distinct = tombstone fingerprint hashes that are NOT in the k-gram hash set of the before text; recovered = those that ARE in the after text's k-gram hash set.
- real re-landing: distinct 1, recovered 1 (1.00). demo rewrite: distinct 2, recovered 1 (0.50). negative (copying the surviving non-chunked call into a new method): distinct 2, recovered 0 (0.00).
Ask:
1. Report a tombstone iff level_after != 'none' AND (level_before == 'none' OR s_after >= s_before + 0.1 OR (distinct >= 1 AND recovered / distinct >= 0.5)). Keep the fast path (no added lines -> exit 0) and the prefilter.
2. Pure helper in src/core/watch.ts: `distinctRecovery(tombstone, beforeText, afterText) -> { distinct, recovered }` using kgramHashSet over normalizeBlock output (same tokenizer). Property: when after == before, recovered is 0.
3. Tests: add the negative case (copying the surviving non-chunked call into a new method of the haunted-http adapter -> exit 0) and a synthetic one-line-difference case modeled on the requests revert (a tombstone that equals a live block plus one extra kwarg line; writing that line back -> exit 2).
4. Update REQ-4 in requirements/design with the rule and the numbers above. npm test + npx tsc --noEmit green; rebuild dist. 3-line summary.
