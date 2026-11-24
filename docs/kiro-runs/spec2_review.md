Review of .kiro/specs/revenant-watch (reviewer). Good spec; one design bug, answers to your open questions, then implement.

1. BUG — REQ-4 "new code" by trimmed-line set membership breaks the demo and the product.
   Measured on the haunted-http fixture: the agent's rewrite (event A) puts the Revert-buried block at lines 16-25 of the new adapter.py. Its lines `method=request.method,`, `url=request.path,`, `body=request.body,` ... already exist in the surviving non-chunked `urlopen` call, so the trimmed-set rule keeps only 4 lines (`from .pool import ConnectionPool`, `response = conn.urlopen(`, `chunked=True,`, `return Response.from_raw(...)`) and the windowed score collapses. A real revenant usually shares many lines with live code.
   A line diff (difflib-style LCS / Myers over lines, disk vs new text) marks lines 16-25 as added (9 of the 10 lines of the matched window).
   Replace the rule with:
   - Build the full post-write text: fs_write -> `text`; str_replace -> the file on disk with `oldStr` replaced by `newStr` (first occurrence, or all when replace_all). If the file does not exist, every line is added.
   - Compute added line numbers with a line diff (insert/replace hunks) between the disk text and the post-write text. Whitespace-only changed lines do not count as added (compare trimmed lines inside the diff).
   - Score every tombstone with matchWindowed over the FULL post-write text, then report it only if at least half of the lines in its matched window are added lines. No added lines -> exit 0 without matching (fast path).
   - Keep `newLines` out; add `addedLineNumbers(before, after): Set<number>` (pure, browser-safe) with properties: addedLineNumbers(x, x) is empty; inserting k non-blank lines that are not whitespace variants marks exactly those k lines.
   - REQ-9 event B (unchanged HEAD adapter) stays exit 0; event A must be exit 2.
   - Add REQ-9 event C: str_replace that swaps the manual `else:` branch for the native chunked call -> exit 2.
2. Open questions:
   Q1 fail open (exit 1) on missing graveyard/bad event: agreed.
   Q2 prefilter: agreed (all-k-gram hash set of the post-write text). The 300-line cap is NOT acceptable as a silent fallback; if the budget is missed, report the measured latency and continue.
   Q3 graveyard ignored + `npm run bury`: agreed.
   Q4 third `thresholds` parameter on hauntLevel: agreed.
3. Small: REQ-5 message — also print the matched line range (`lines 16-25`) so the agent knows where. Keep under 1,200 chars.

Now: update requirements.md/design.md/tasks.md for the above, then implement Batch A (tasks 1-2) and Batch B (tasks 3-4). Each batch ends with npm test + npx tsc --noEmit green. Mark finished tasks in tasks.md. Print a 5-line summary with test counts.
