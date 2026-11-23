# 👻 Déjà Boo

**Your codebase remembers what it buried.**

AI coding agents don't read git history. Ask one to "add caching" and it may happily re-create the exact code your team deleted months ago because it leaked memory. Déjà Boo mines your git history for deleted code (*tombstones*), and when an agent or a human is about to write that code again (*a revenant*), it raises a ghost with the evidence: when it died, why, and in which commit.

> 🎃 Built for **Kiroween 2026** (Costume Contest) with [Kiro](https://kiro.dev): specs, steering, hooks, MCP, property-based tests, and a Kiro Power.

## Status
🚧 Work in progress (Kiroween 2026 runs until Dec 4).
- ✅ **Graveyard miner** (`deja-boo index`): spec [`graveyard-miner`](.kiro/specs/graveyard-miner/), 177 unit + property tests. Indexes express (5,701 commits) in 1.7 s.
- ✅ **Revenant watch**: `deja-boo check`, the Kiro `PreToolUse` guard hook and the MCP server. Spec [`revenant-watch`](.kiro/specs/revenant-watch/).
- 🔜 **Haunted graveyard** web UI and the Kiro Power.

See [`.kiro/steering/product.md`](.kiro/steering/product.md) for the product brief.

## Why it matters
We ran the miner on 6 popular open-source repos: axios, httpie/cli, express, flask, got and requests. That is 19,908 commits and 7,094 tombstones.
- Deleted code came back more than a week later **44 times**.
- We judged all 44 by hand. **12 are clearly real**: 6 reverts, plus 6 re-introductions that the commit message admits. Nine are noise, and the rest need a closer look.

Two real examples:
- **requests** replaced its hand-rolled chunked upload with `urlopen(chunked=...)` in 2019. The change was reverted 7 months later. The same idea landed again in 2023, once urllib3 had fixed the underlying bug.
- **express** removed its default `OPTIONS` response. The removal was reverted 321 days later.

That is the knowledge an AI agent does not have when it "simplifies" your code.

How well the matcher catches rewritten dead code, and how often it is wrong, is measured in [`research/matching-eval.md`](research/matching-eval.md). See also the bugs that property-based tests caught: [`research/pbt-findings.md`](research/pbt-findings.md).

## Using the guard
1. **Bury.** `npm run bury` builds the CLI and writes `.deja-boo/graveyard.json` (ignored by git, rebuild it whenever history changes).
2. **Check a file.** `node dist/cli/main.js check src/some-file.ts` (or `-` for stdin). Exit 0 clean, 1 warn, 2 block, 3 no graveyard. The report shows the tombstone id, commit, date, the cause of death verbatim, the deleted lines and the matched line range.
3. **Hook.** `.kiro/hooks/deja-boo-guard.json` runs `node dist/cli/main.js hook` before every write tool. It scores each tombstone on the file on disk and on the post-write text, and exits 2 (with the evidence on stderr) only when the write makes a tombstone worse: it was below warn before, or its similarity rose by 0.1 or more. Unchanged or unrelated edits stay silent. A broken setup (no graveyard, bad event) exits 1 and never blocks.
4. **MCP.** `.kiro/settings/mcp.json` registers `dist/mcp/server.js` with `check_snippet`, `get_tombstone` and `list_graveyard`, so the agent can read why something died.
5. **Acknowledge.** If the cause no longer applies, add a comment containing `deja-boo: checked <tombstone id>` (any comment syntax) to the code you write. Only that id is silenced.
6. **Config.** `.deja-boo/config.json`: `{"thresholds": {"warn": 0.5, "block": 0.7}}` with `0 < warn <= block <= 1`. An invalid file falls back to these defaults. The defaults come from [`research/matching-eval.md`](research/matching-eval.md).

## License
[MIT](LICENSE)
