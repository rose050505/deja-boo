# 👻 Déjà Boo

**Your codebase remembers what it buried.**

AI coding agents don't read git history. Ask one to "add caching" and it may happily re-create the exact code your team deleted months ago because it leaked memory. Déjà Boo mines your git history for deleted code (*tombstones*), and when an agent or a human is about to write that code again (*a revenant*), it raises a ghost with the evidence: when it died, why, and in which commit.

> 🎃 Built for **Kiroween 2026** (Costume Contest) with [Kiro](https://kiro.dev): specs, steering, hooks, MCP, property-based tests, and a Kiro Power.

**🪦 Live demo: https://rose050505.github.io/deja-boo/** (paste any snippet and see whether it has died before)

## Status
All three specs are implemented, with 343 unit and property tests.
- ✅ **Graveyard miner** (`deja-boo index`): spec [`graveyard-miner`](.kiro/specs/graveyard-miner/). Indexes express (5,701 commits) in 1.7 s.
- ✅ **Revenant watch**: `deja-boo check`, the Kiro guard hooks (`PreToolUse` write + `Stop` diff) and the MCP server. Spec [`revenant-watch`](.kiro/specs/revenant-watch/).
- ✅ **Haunted graveyard** web app, deployed to GitHub Pages. Spec [`haunted-graveyard`](.kiro/specs/haunted-graveyard/).
- ✅ **Kiro Power** ([`power/`](power/)) and the [`graveyard-keeper`](.kiro/agents/graveyard-keeper.json) custom agent.

All product code was written by Kiro CLI running headless. The logs of every run are in [`docs/kiro-runs/`](docs/kiro-runs/).

See [`.kiro/steering/product.md`](.kiro/steering/product.md) for the product brief.

## Why it matters
We ran the miner on 6 popular open-source repos: axios, httpie/cli, express, flask, got and requests. That is 19,908 commits and 6,301 tombstones.
- Deleted code came back more than a week after its death **50 times**, 6 of them by Revert.
- In an earlier run with 44 such comebacks, we judged every one by hand. **12 were clearly real**: 6 reverts, plus 6 re-introductions that the commit message admits.

**We also tried it on real history.** We checked out psf/requests as it was in April 2023 and asked Kiro to "simplify" the upload code.
- **Without Déjà Boo:** Kiro re-wrote exactly the code requests had reverted in 2020.
- **With Déjà Boo:** the guard stopped it with the tombstone, and Kiro checked why the code had died before deciding.

Details are in [`research/matching-eval.md`](research/matching-eval.md), section 7.

Two real examples:
- **requests** replaced its hand-rolled chunked upload with `urlopen(chunked=...)` in 2019. The change was reverted 7 months later. The same idea landed again in 2023, once urllib3 had fixed the underlying bug.
- **express** removed its default `OPTIONS` response. The removal was reverted 321 days later.

That is the knowledge an AI agent does not have when it "simplifies" your code.

How well the matcher catches rewritten dead code, and how often it is wrong, is measured in [`research/matching-eval.md`](research/matching-eval.md). See also the bugs that property-based tests caught: [`research/pbt-findings.md`](research/pbt-findings.md).

## Using the guard
1. **Bury.** `npm run bury` builds the CLI and writes `.deja-boo/graveyard.json` (ignored by git, rebuild it whenever history changes).
2. **Check a file.** `node dist/cli/main.js check src/some-file.ts` (or `-` for stdin). Exit 0 clean, 1 warn, 2 block, 3 no graveyard. The report shows the tombstone id, commit, date, the cause of death verbatim, the deleted lines and the matched line range.
3. **Hook.** `.kiro/hooks/deja-boo-guard.json` runs `node dist/cli/main.js hook` before every write tool. It scores each tombstone twice: on the file as it is on disk, and on the text after the write. It exits 2, with the evidence on stderr, only when the write makes a tombstone worse:
   - the tombstone was below warn before, or
   - its similarity rose by 0.1 or more, or
   - the write brings back at least half of the tombstone's fingerprint that is missing from the file today (one decisive line counts).

   Unchanged or unrelated edits stay silent. A broken setup (no graveyard, bad event) exits 1 and never blocks. The write hook catches tool writes before they land. A second entry, a `Stop` hook running the same command, catches everything else (shell edits, generated files): when the agent finishes, it diffs the working tree against `HEAD` and, if the changes resurrect buried code, prints `{"decision":"block","reason":...}` so the agent takes another turn. It blocks at most once per session for the same set of tombstones (state in `.deja-boo/stop-state.json`, ignored by git), so an agent that disagrees is never trapped.
4. **MCP.** `.kiro/settings/mcp.json` registers `dist/mcp/server.js` with `check_snippet`, `get_tombstone` and `list_graveyard`, so the agent can read why something died.
5. **Acknowledge.** If the cause no longer applies, add a comment containing `deja-boo: checked <tombstone id>` (any comment syntax) to the code you write. Only that id is silenced.
6. **Config.** `.deja-boo/config.json`: `{"thresholds": {"warn": 0.5, "block": 0.7}}` with `0 < warn <= block <= 1`. An invalid file falls back to these defaults. The defaults come from [`research/matching-eval.md`](research/matching-eval.md).

7. **Kiro Power.** `power/` packages the MCP server, a skill and a copy-ready guard hook. See [`power/README.md`](power/README.md). `deja-boo mcp` starts the MCP server; `npm run bury` refreshes the graveyard after history changes (no automatic refresh hook: it builds and re-mines, which is too slow to run on every task).
8. **Review agent.** `.kiro/agents/graveyard-keeper.json` reviews the branch diff against the graveyard before merge.

## Haunted graveyard (web)

A static page that draws the graveyard and runs the detector in the browser.

    npm run web                                # dev server
    npm run web:build && npm run web:preview   # production build, served locally
    npm run web:data -- <requests> <express> <axios> <flask> <got> <cli>   # rebuild web/public/graveyards from local clones

`.github/workflows/pages.yml` deploys `web/` to GitHub Pages under `/deja-boo/`: https://rose050505.github.io/deja-boo/

## License
[MIT](LICENSE)
