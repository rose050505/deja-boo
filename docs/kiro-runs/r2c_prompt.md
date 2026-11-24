Reviewer: the hook does NOT fire on the demo, and the cause is my earlier advice. Please fix it, then finish the spec (Batch E-F, tasks 9-12).

1. BUG (end-to-end): built dist, indexed the haunted-http fixture into <repo>/.deja-boo/graveyard.json, and piped REQ-9 event A (fs_write of the native-chunked adapter.py with raw->response) into `node dist/cli/main.js hook` with cwd = the fixture: exit 0, nothing on stderr. Expected exit 2.
   Debug: matchWindowed gives the Revert stone 0.94 at lines 15-24 (level block), but addedLineNumbers(disk, after) = {3, 16, 24, 27}. The diff on TRIMMED lines aligns the rewritten `method=request.method,` ... lines with the identical lines of the surviving non-chunked call, so only 2 of 10 window lines count as added and the ADDED_SHARE rule drops the hit. Any rewrite that reuses lines of live code will be missed the same way.
   Replace the ADDED_SHARE rule with a "this write makes it worse" rule:
   - before = the disk text, after = the post-write text (unchanged definitions).
   - If addedLineNumbers(before, after) is empty: exit 0 (keep this fast path).
   - For each tombstone: s_after = matchWindowed(after).similarity, s_before = matchWindowed(before).similarity (0 when the file does not exist). level_after = hauntLevel(t, s_after, thresholds), level_before likewise.
   - Report the tombstone iff level_after != 'none' AND (level_before == 'none' OR s_after >= s_before + 0.1).
   - Rationale: an unchanged or unrelated edit never raises the score, so it never fires (event B, and copying the surviving non-chunked call elsewhere keeps 0.78 -> no new hit); a rewrite toward the buried variant raises it (demo: 0.78 -> 0.94).
   - Keep the exact prefilter (apply it to both before and after). Update requirements/design (REQ-4) and the properties: (a) a write whose post-write text equals the disk text never fires; (b) for any tombstone embedded verbatim into a file that did not contain it, the hook fires unless acknowledged or alive-non-Revert.
2. Then Batch E (tasks 9-10) and Batch F (tasks 11-12) as specified, including REQ-9 events A, B and C, with one spawned `node dist/cli/main.js hook` process run for event A. Task 12: also run `npm run bury` and `node dist/cli/main.js check` on one repo file.
Each batch ends with npm test + npx tsc --noEmit green; mark tasks done in tasks.md. Print a 5-line summary with test counts.
