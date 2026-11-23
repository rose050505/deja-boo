# Revenant Watch: Requirements

## Overview

Revenant Watch is the "Watch" and "Haunt" half of Déjà Boo's core loop. It takes new code, looks for tombstones in the graveyard that the code resurrects, and tells humans (CLI) and AI agents (Kiro hook, MCP) what was buried, when, and why.

It builds on the finished `graveyard-miner` spec. These already exist in `src/core` and are reused without change to their behavior:

- the shared tokenizer (`tokenize.ts`) and `fingerprintLines`
- `matchWindowed(tombstone, candidateLines)`, which returns `{ similarity, matchedLines, containment }`
- `hauntLevel(tombstone, similarity)` (gains an optional `thresholds` parameter, REQ-2), which returns `'none' | 'warn' | 'block'`
- `shouldSkip(path, patterns)`
- `fromGraveyardJson`

Terms: *added lines* are the lines of the post-write text that a line diff against the file on disk marks as inserted or replaced (whitespace-only changes do not count). An *unacknowledged revenant* is a revenant whose tombstone id is not named by a `deja-boo: checked <id>` comment in the written content.

## Kiro facts this spec relies on

- Hook files are `.kiro/hooks/*.json`: `{"version":"v1","hooks":[{"name","trigger":"PreToolUse","matcher":"write","action":{"type":"command","command":"..."}}]}`.
- PreToolUse stdin is `{"hook_event_name","cwd","session_id","tool_name","tool_input"}`. For `fs_write`, `tool_input` is `{path, text}`. For `str_replace`, it is `{path, oldStr, newStr, replace_all}`.
- Exit 2 blocks the tool call and sends stderr to the agent. In headless Kiro CLI, exit 0 stdout, exit 1, and PostToolUse output do not reach the agent. Every message that must reach the agent is therefore an exit 2 with stderr.
- Workspace MCP config is `.kiro/settings/mcp.json`: `{"mcpServers":{"deja-boo":{"command":"node","args":["dist/mcp/server.js"],"disabled":false,"autoApprove":[...]}}}`.

## Requirements

### REQ-1: Matching engine

**EARS:** When the system compares candidate lines with the graveyard, it shall score each tombstone with `matchWindowed` from `src/core` and shall derive the level only from `hauntLevel`.

- No other code path may compute a level. In particular, `aliveAtHead` tombstones are suppressed by `hauntLevel` (except Reverts), and the watcher must not reimplement that rule.
- A tombstone whose level is `'none'` is not a revenant and is never reported.
- Revenants are ordered by similarity descending, then by tombstone id ascending, so output is deterministic.

### REQ-2: Configurable thresholds

**EARS:** Where `.deja-boo/config.json` defines `thresholds.warn` and `thresholds.block`, the system shall use them in place of the defaults 0.5 and 0.7.

- The defaults are the numbers in `research/matching-eval.md` (section "Recommendations", item 4). They stay exported from `src/core/level.ts` as `WARN_THRESHOLD` and `BLOCK_THRESHOLD`. Any change to the defaults requires new numbers in `research/`.
- `hauntLevel` gains an optional third parameter `thresholds = { warn, block }` that defaults to the constants. Calls with two arguments behave exactly as before.
- The block-needs-evidence rule (Revert cause or an issue/PR link) is unchanged and applies at any configured block threshold.
- **EARS:** If the config file is missing, the system shall use the defaults. If the file is not valid JSON, or a threshold is not a number with 0 < warn <= block <= 1, the system shall ignore the whole `thresholds` object and use the defaults. `check` reports this on stderr. `hook` stays silent about it (exit 1 and stdout never reach the agent, so a message there would be lost, and a bad config alone must not block a write).
- The config is read from `<cwd>/.deja-boo/config.json`. `cwd` is the process directory for `check` and the event's `cwd` for `hook`.

### REQ-3: `deja-boo check <file|->`

**EARS:** When the user runs `deja-boo check <file>` (or `-` for stdin), the system shall match the whole input against `.deja-boo/graveyard.json` and print every revenant with its evidence.

For each revenant the output contains:

- tombstone id and tombstone path
- commit (full hash) and date (`buriedAt`)
- cause of death, verbatim from the tombstone, or the text `cause of death unknown` when it is empty
- links (`PR #n`, `issue #n`), when present
- the deleted lines (first 20, then `… N more lines`)
- the matched line range in the input
- similarity and containment (two decimals)
- the level (`warn` or `block`)

**Exit codes:** 0 when there is no revenant, 1 when the highest level is `warn`, 2 when it is `block`.

- **EARS:** If the graveyard file is missing or unreadable, `check` shall print how to create it (`deja-boo index . --out .deja-boo/graveyard.json`) on stderr and exit 3. Exit 3 is distinct from the three result codes, so a broken setup is never read as "clean".
- Containment is shown as evidence only. It never decides a level.
- `check` honors the skip list: input whose path is skipped yields no revenants (the `-` form has no path and is never skipped).

### REQ-4: `deja-boo hook`

**EARS:** When `deja-boo hook` receives a PreToolUse JSON event on stdin, the system shall match the full post-write text and report only revenants that the write makes worse than the file on disk.

**Which code is checked:**

Trimmed-line set membership and a per-window "added share" are both rejected: a real revenant shares many lines with live code (measured on `haunted-http`: the Revert-buried block sits at lines 15-24 of the rewritten `adapter.py` with similarity 0.94, but a trimmed-line diff aligns the rewritten `method=request.method,` lines with the identical lines of the surviving non-chunked call, so only 2 of 10 window lines count as added and the hook stayed silent). The rule compares scores before and after the write instead.

1. **Post-write text.** `fs_write`: `tool_input.text`. `str_replace`: the file on disk with `oldStr` replaced by `newStr` (first occurrence, or every occurrence when `replace_all` is true). If the file does not exist, the disk text is empty and every line is added. A `str_replace` whose `oldStr` is not found on disk changes nothing, so it exits 0.
2. **Added lines.** `addedLineNumbers(before, after)` runs a line diff (Myers, comparing trimmed lines) between the disk text and the post-write text. Lines in insert or replace hunks are added. A line that differs only in whitespace is matched by the diff, so it is not added (whitespace-only churn is not resurrection, `evidence-first`). No added lines: exit 0 without matching (fast path).
3. **Matching ("this write makes it worse").** Let `before` be the disk text and `after` the post-write text. For each tombstone, `s_after` is `matchWindowed` over `after` and `s_before` is `matchWindowed` over `before` (0 when the file does not exist). `level_after` and `level_before` come from `hauntLevel` with the configured thresholds. A tombstone is reported only if `level_after != 'none'` and (`level_before == 'none'` or `s_after >= s_before + 0.1` or (`distinct >= 1` and `recovered / distinct >= 0.5`)). `distinctRecovery(tombstone, beforeText, afterText)` takes the tombstone fingerprint hashes that are not in the k-gram hash set of the normalized `before` text (`distinct`) and counts those that are in the set of the normalized `after` text (`recovered`), with the same tokenizer and `kgramSize`. The recovery clause exists because real reverts often differ from live code by one decisive line. Measured on psf/requests at `26bea1e4^` (6,143 commits): the Revert tombstone `a36a5b61` (13 lines, `resp = conn.urlopen(... chunked=chunked)`) scores s_before 0.90 and s_after 0.95 against the real re-landing `26bea1e4` ("Use urllib3 native chunking ability (#6226)"), below the +0.1 margin. Recovery: real re-landing distinct 1, recovered 1 (1.00); demo rewrite distinct 2, recovered 1 (0.50); copying the surviving non-chunked call into a new method distinct 2, recovered 0 (0.00). An unchanged or unrelated edit never raises a score, so it never fires; a rewrite toward the buried variant does (demo: 0.78 to 0.94). The exact prefilter applies to both `before` and `after`.
- Any other `tool_name`: exit 0 with no output.
- **EARS:** If `tool_input.path` matches the skip list, the system shall exit 0 with no output.

**Outcomes:**

- No unacknowledged revenant: exit 0, nothing on stdout or stderr.
- Warn or block: exit 2 with a short message on stderr (REQ-5). The hook uses exit 2 for `warn` as well as `block`, because nothing else reaches the agent in headless Kiro CLI. The message states the level so the agent knows a warn can be answered with the acknowledgement comment.
- **EARS:** If the event is not valid JSON, lacks the fields above, or the graveyard is missing, the system shall exit 1 with a one-line reason on stderr. Exit 1 never blocks the tool call, so a broken setup fails open instead of freezing the agent. (Verified fact: exit 1 does not reach a headless agent. The line is for the human's log.)

**Acknowledgement:**

- **EARS:** When the written content (the whole `text` for `fs_write`, `newStr` for `str_replace`) contains `deja-boo: checked <id>` for every matched tombstone id, the system shall exit 0. The comment can use any comment syntax, since only the substring is matched with `/deja-boo: checked ([0-9a-f]{40})/g`.
- When only some matched ids are acknowledged, the hook exits 2 and the message lists only the unacknowledged tombstones.
- Acknowledgement is scoped to the ids named. It never silences other tombstones.

**Latency:**

- **EARS:** The hook shall answer in under 200 ms (process start excluded from the test budget, measured inside the process) for a graveyard of 1,500 tombstones and a write of up to 300 lines. It loads `.deja-boo/graveyard.json` once per process and uses the stored fingerprints without recomputing tombstone fingerprints.

### REQ-5: Hook message

**EARS:** When the hook blocks, it shall write to stderr one entry per unacknowledged revenant (at most 3, then `… and N more buried things`), each in this shape, using facts from history only:

```
👻 Déjà Boo: this code was buried on <date> in <commit7> — <cause of death> (<links>). Similarity <s> to tombstone <id>, lines <from>-<to> of this write. Read it with the MCP tool get_tombstone. If the cause no longer applies, add the comment `deja-boo: checked <id>` near the code and write again.
```

- `<from>-<to>` is the matched line range in the post-write text (`matchedLines`, 1-based).
- `<date>` is the `YYYY-MM-DD` part of `buriedAt`. `<commit7>` is the first 7 characters of the commit. `<s>` has two decimals.
- `<cause of death>` is the tombstone's `causeOfDeath` verbatim. If it is empty, the text is `cause of death unknown`. The message never states a reason that is not in history.
- `(<links>)` is omitted when the tombstone has no links.
- The ghost voice is limited to the 👻 prefix and the fixed sentences above. No claim is made beyond what the tombstone records.
- A message is plain text, no color codes, and under 1,200 characters per entry (a long cause of death is cut with `…` so the entry fits; the cut never touches the id, commit, or line range).

### REQ-6: MCP server

**EARS:** When an MCP client connects over stdio to `src/mcp/server.ts` (built to `dist/mcp/server.js`), the system shall expose these tools using `@modelcontextprotocol/sdk`.

- `check_snippet(code, path?)`: match `code` the same way as `check`, with the configured thresholds. Returns `{ level, revenants: [...] }`. Each revenant carries `id, level, similarity, containment, matchedLines, path, commit, buriedAt, causeOfDeath, links`. When `path` matches the skip list, the result is `level: "none"` with no revenants.
- `get_tombstone(id)`: the full tombstone (all history fields, including `lines`, `revivals`, `deaths`, `aliveAtHead`). **EARS:** If the id is unknown, the system shall return an MCP error result `no tombstone with id <id>`.
- `list_graveyard(limit?, path?)`: tombstone summaries (`id, path, buriedAt, commit, causeOfDeath, links, lineCount, aliveAtHead`), newest first, ties by id. `limit` defaults to 20 and is capped at 100. `path` keeps tombstones whose path equals it or starts with `<path>/`.
- Responses contain only fields from the graveyard or numbers computed from it (`evidence-first`). `causeOfDeath` is verbatim, and an empty one is returned as the string `cause of death unknown`.
- The server never writes to stdout except MCP protocol frames. Diagnostics go to stderr.
- The server reads the graveyard once at startup and the config at each `check_snippet` call. If the graveyard is missing, tools return an MCP error that explains how to create it.

### REQ-7: Dogfooding

**EARS:** The repository shall carry `.kiro/hooks/deja-boo-guard.json` and `.kiro/settings/mcp.json` so that Déjà Boo guards its own development.

- Hook file: `{"version":"v1","hooks":[{"name":"deja-boo-guard","trigger":"PreToolUse","matcher":"write","action":{"type":"command","command":"node dist/cli/main.js hook"}}]}`.
- MCP file: the `deja-boo` server entry with `command: "node"`, `args: ["dist/mcp/server.js"]`, `disabled: false`, and `autoApprove` of the three tools.
- `.kiro/` stays out of `.gitignore`.
- A test parses both files and asserts these shapes.

### REQ-8: Property tests (fast-check)

Each property runs as a Vitest test with fast-check.

1. For any fingerprints, `similarity` is in [0, 1]. For any non-empty fingerprint, `similarity(fp, fp) === 1`. For any candidate that embeds a tombstone's own lines, `matchWindowed(...).similarity === 1`.
2. **Threshold monotonicity:** raising `warn` or `block` never adds a revenant and never raises a level.
3. **Added lines:** `addedLineNumbers(x, x)` is empty; inserting k non-blank lines that are not whitespace variants of existing lines marks exactly those k lines. **Hook exit code:** the exit code is 0 if and only if there is no unacknowledged revenant. Otherwise it is 2. **Worse-only:** a write whose post-write text equals the disk text never fires; any tombstone embedded verbatim into a file that did not contain it fires unless it is acknowledged or alive at HEAD with a non-Revert cause.
4. **Acknowledgement:** for any event, appending `deja-boo: checked <id>` for every matched id to the written content yields exit 0.
5. **Alive at HEAD:** a tombstone with `aliveAtHead: true` and a non-Revert cause is never reported, whatever the candidate and thresholds.

### REQ-9: Demo acceptance test

**EARS:** When the test suite runs, it shall build the `haunted-http` fixture with `src/test-fixtures/haunted-http.sh`, index it, and feed the hook two events.

- Event A: `fs_write` to `haunted_http/adapter.py`, whose `text` is the native-chunked `adapter.py` (from the commit "Use the pool's native chunked mode for uploads") with `\braw\b` replaced by `response`. Expected: exit 2, and stderr contains the Revert tombstone's id, its first 7 commit characters, and its cause of death verbatim (`Revert "Use the pool's native chunked mode for uploads"`).
- Event B: `fs_write` to the same path, whose `text` is the current manual-chunk `adapter.py` at HEAD, unchanged (the disk file is the HEAD file). Expected: exit 0 and empty stderr.
- Event C: `str_replace` on the HEAD `adapter.py` that swaps the manual `else:` branch for the native chunked call (`oldStr` is the manual branch, `newStr` is the native call from the same commit). Expected: exit 2 with the same evidence as event A.
- For event A the matched window is the level block of the new text (lines 15-24 measured; the test asserts the lines printed in stderr), and the test asserts `s_after >= s_before + 0.1` (measured 0.78 to 0.94).
- The event's `cwd` is the fixture repo. The graveyard is written to `<repo>/.deja-boo/graveyard.json`.
- The test runs the real entry point (`runHook` against stdin text and a working directory) and also one spawned `node dist/cli/main.js hook` run to prove exit codes survive the process boundary.

## Out of scope

- Blocking on containment alone.
- Checking PostToolUse output (it does not reach the agent).
- A web UI for matches (a later spec).
- Changing the matching defaults or tokenizer (requires numbers in `research/`).
- Auto-writing the acknowledgement comment for the agent.
