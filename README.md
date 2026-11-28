# 👻 Déjà Boo

**Your codebase remembers what it buried.**

AI coding agents don't read git history. Ask one to "add caching" and it may happily re-create the exact code your team deleted months ago because it leaked memory. Déjà Boo mines your git history for deleted code (*tombstones*), and when an agent or a human is about to write that code again (*a revenant*), it raises a ghost with the evidence: when it died, why, and in which commit.

> 🎃 Built for **Kiroween 2026** (Costume Contest) with [Kiro](https://kiro.dev): specs, steering, hooks, MCP, property-based tests, and a Kiro Power.

**🪦 Live demo: https://rose050505.github.io/deja-boo/** (paste a snippet and see whether it died in one of the sample repositories; for your own repository, use the CLI below)

**🎥 Demo video (2:54): https://youtu.be/E0bHgE6uA8I** (Kiro CLI with and without the guard on real psf/requests history)

## Status
All four specs are implemented, with 617 unit and property tests.
- ✅ **Graveyard miner** (`deja-boo index`): spec [`graveyard-miner`](.kiro/specs/graveyard-miner/). Indexes express (5,701 commits) in 12 s.
- ✅ **Revenant watch**: `deja-boo check`, the Kiro guard hooks (`PreToolUse` write + `Stop` diff) and the MCP server. Spec [`revenant-watch`](.kiro/specs/revenant-watch/).
- ✅ **Haunted graveyard** web app, deployed to GitHub Pages. Spec [`haunted-graveyard`](.kiro/specs/haunted-graveyard/).
- ✅ **Obituary** (`deja-boo obituary`, opt-in): the opening text of the pull request or linked issue behind each death commit, quoted verbatim from GitHub and shown as data, not instructions. Spec [`obituary`](.kiro/specs/obituary/).
- ✅ **Kiro Power** ([`power/`](power/)) and the [`graveyard-keeper`](.kiro/agents/graveyard-keeper.json) custom agent.

All product code was written by Kiro CLI running headless. The logs of every run are in [`docs/kiro-runs/`](docs/kiro-runs/). One commit (2141fd9) is a reviewer's `git revert` that restored Kiro's earlier code.

See [`.kiro/steering/product.md`](.kiro/steering/product.md) for the product brief.

## Why it matters
We ran the miner on 6 popular open-source repos: axios, httpie/cli, express, flask, got and requests. That is 19,908 commits and 5,146 tombstones.
- Deleted code came back more than a week after its death **26 times** (one count per commit, not per record): 26 comebacks, 20 confirmed real by a reviewer who opened each one in git (labels in [`research/labels/`](research/labels/)), 2 ambiguous, 4 false; all 7 via Revert are real.
- A reviewer opened every comeback an earlier version reported (50 records) in git: only 20 were real. Most of the rest were reformats and moves where the code never died. The miner now ignores those, checks that the code was really gone and that the re-adding commit comes after the death, rejects a comeback when the rest of the tree already holds as much of the code as the comeback does, skips licence and generated sponsor files, and counts a cherry-picked patch once. A second labelling pass on the 32 comebacks that remained found 10 false ones; 6 are gone. On all labels the miner keeps 19 of the 23 real comebacks and drops 33 of the 37 false ones, and it finds 14 of 21 re-additions the reviewer found independently. The 4 false ones left and the 4 real ones lost are listed in [`research/matching-eval.md`](research/matching-eval.md) sections 9 and 11.
- The commit message of a Revert rarely says why. Asking GitHub which pull request merged each death commit (`deja-boo obituary`, 990 requests for the 6 repos) gives 1,410 of the 5,169 tombstones the opening text of a PR or linked issue, and raises the Reverts that carry a reason from 37 to 57 of 71 (only 3 had an explicit PR or issue link). [`research/obituary-eval.md`](research/obituary-eval.md) section 2.

**We also tried it on real history.** We checked out psf/requests as it was in April 2023 and asked Kiro to "simplify" the upload code.
- **Without Déjà Boo:** Kiro re-wrote exactly the code requests had reverted in 2020.
- **With Déjà Boo:** the guard stopped it with the tombstone, and Kiro checked why the code had died before deciding.

Details are in [`research/matching-eval.md`](research/matching-eval.md), section 7.

Two real examples:
- **requests** replaced its hand-rolled chunked upload with `urlopen(chunked=...)` in 2019. The change was reverted 7 months later. The same idea landed again in 2023, after review, when requests needed full urllib3 2.0 support.
- **express** removed its default `OPTIONS` response. The removal was reverted 321 days later.

That is the knowledge an AI agent does not have when it "simplifies" your code.

How well the matcher catches rewritten dead code, and how often it is wrong, is measured in [`research/matching-eval.md`](research/matching-eval.md). See also the bugs that property-based tests caught: [`research/pbt-findings.md`](research/pbt-findings.md).

## Use it on your repo

1. **Install.** `npm install -g github:rose050505/deja-boo` (Node 24 or newer; the install builds `dist/`). Or run everything through `npx -y github:rose050505/deja-boo <command>`.
2. **Index.** In the repository root run `deja-boo index`. It mines the full git history and writes `.deja-boo/graveyard.json` (creating `.deja-boo/`). Add `.deja-boo/graveyard.json`, `.deja-boo/obituaries.json` and `.deja-boo/stop-state.json` to your `.gitignore`, and run `deja-boo index` again whenever history changes. Try `deja-boo check src/some-file.ts`. To see the graveyard, open [the page](https://rose050505.github.io/deja-boo/) and drop `.deja-boo/graveyard.json` on it; the file is read in your browser and never uploaded.
   Optional, uses the network: `deja-boo obituary --limit 50` asks GitHub which pull request merged each death commit and stores the start of its text, so warnings say why the code died even when the commit message is just `Revert "x"` (see item 8 below).
3. **Add the hooks.** Install the Kiro Power in [`power/`](power/README.md) (MCP tools and skill), then copy the guard (from a clone of this repository, or download `power/hooks/deja-boo-guard.json`): `mkdir -p .kiro/hooks && cp power/hooks/deja-boo-guard.json .kiro/hooks/`. It runs `npx -y github:rose050505/deja-boo hook` before every write and when the agent stops, so it works in any repository. (This repository's own `.kiro/hooks/` use `node dist/cli/main.js` and only work here.)

If the graveyard is missing, the hook does not block. It prints one line to stderr (`deja-boo: no graveyard at .deja-boo/graveyard.json ... This write was not checked.`) and exits 0, so run step 2.

## What it can't see

Déjà Boo finds code that comes back as a block of 4 or more lines, close to how it was deleted. Renaming identifiers is covered: with 2 to 4 renamed identifiers, 91% of rewritten tombstones still reach warn (76% before the renamed score; section 10 of the research). A match that needs the renaming is only a warning, never a block. A reviewer replayed real history on three repos it had never been tuned on (click 3,416 commits, black 2,525, koa 1,328). Blocks of 4 or more lines that came back were caught 8 of 9 times, and ordinary writes fired about once in 212 (0.5%). The same replay shows what it misses:

- **Scattered small deletions.** Of 18 real revert and restore commits, 3 were caught. A revert that is spread over many 1 to 3 line hunks leaves no block of 4 lines to remember (click 0d1b8ea: six hunks of 1 to 2 lines). Merging the hunks of one commit might catch some of these, but it would also create false alarms, and no one has measured how many, so it is not done.
- **Code lost in a merge resolution.** The miner skips merge commits (`--no-merges`), so a deletion made while resolving a conflict has no tombstone (click c52f43c).
- **Short idioms.** A deleted block with fewer than 4 distinct fingerprint hashes is not watched, because such idioms fired on unrelated code. In the 6 research repos this dropped 196 of 6,166 tombstones (3.2%), among them 1 of the 20 real comebacks the reviewer labelled. Lower it with `deja-boo index --min-hashes 1` and `"minHashes": 1` in `.deja-boo/config.json`.
- **Small edits are deaths, reformats are not.** A deleted block counts as moved or reformatted, not dead, when 97% of its fingerprint is still in the commit. Changing one flag in four lines keeps about 93%, so that is a death; this keeps real reverts such as requests' chunked upload. Change it with `--alive-after-death`. A comeback is not counted when the parent tree (or the commit's own deletions) already holds at least its own similarity of the code; `--alive-margin` loosens that.
- **Comments and generated files.** Comment-only blocks, lock files, `dist/`, vendored code and prose docs are skipped on purpose.

## Using the guard
1. **Bury.** `npm run bury` builds the CLI and writes `.deja-boo/graveyard.json` (ignored by git, rebuild it whenever history changes). `deja-boo index` writes the same file by default; `--out` picks another path.
2. **Check a file.** `node dist/cli/main.js check src/some-file.ts` (or `-` for stdin). Exit 0 clean, 1 warn, 2 block, 3 no graveyard. A file inside the repository is compared with its version at `HEAD`, so code that is already committed does not alarm and only what the new text makes worse is reported; `--no-head` checks the text alone. The MCP tool `check_snippet` does the same when it is given a `path`. The report shows the tombstone id, commit, date, the cause of death verbatim, the deleted lines and the matched line range.
3. **Hook.** `.kiro/hooks/deja-boo-guard.json` runs `node dist/cli/main.js hook` before every write tool. It scores each tombstone twice: on the file as it is on disk, and on the text after the write. It exits 2, with the evidence on stderr, only when the write makes a tombstone worse:
   - the tombstone was below warn before, or
   - its similarity rose by 0.1 or more, or
   - the write brings back at least half of the tombstone's fingerprint that is missing from the file today (one decisive line counts).

   Unchanged or unrelated edits stay silent. A bad event exits 1 and a missing graveyard exits 0 with one line on stderr; neither blocks. The write hook catches tool writes before they land. A second entry, a `Stop` hook running the same command, catches everything else (shell edits, generated files): when the agent finishes, it diffs the working tree against `HEAD` and, if the changes resurrect buried code, prints `{"decision":"block","reason":...}` so the agent takes another turn. It blocks at most once per session for the same set of tombstones (state in `.deja-boo/stop-state.json`, ignored by git), so an agent that disagrees is never trapped.
4. **MCP.** `.kiro/settings/mcp.json` registers `dist/mcp/server.js` with `check_snippet`, `get_tombstone` and `list_graveyard`, so the agent can read why something died.
5. **Acknowledge.** If the cause no longer applies, add a comment containing `deja-boo: checked <tombstone id>` (any comment syntax) to the code you write. Only that id is silenced.
6. **Config.** `.deja-boo/config.json`: `{"thresholds": {"warn": 0.5, "block": 0.7}, "minHashes": 4}` with `0 < warn <= block <= 1` and `minHashes` a non-negative integer (tombstones with fewer distinct hashes are not watched). An invalid value falls back to its default. The defaults come from [`research/matching-eval.md`](research/matching-eval.md).

7. **Kiro Power.** `power/` packages the MCP server, a skill and a copy-ready guard hook. See [`power/README.md`](power/README.md). `deja-boo mcp` starts the MCP server; `npm run bury` refreshes the graveyard after history changes (no automatic refresh hook: it builds and re-mines, which is too slow to run on every task).
8. **Obituary (optional, uses the network).** A commit message often says only `Revert "x"`. `deja-boo obituary` asks the GitHub API which pull request merged each death commit and stores the start of its text (400 characters at most; see below for what is dropped first) and of the issues it links in `.deja-boo/obituaries.json` (ignored by git). Run `deja-boo index` first. Auth: `GITHUB_TOKEN`, else `gh auth token`, else none (60 requests per hour; with a token 5,000). `--limit N` caps the number of commits looked up (default 300; each costs 1 to 4 requests; Reverts, revived and linked tombstones go first, newest first). When the rate limit is reached the entries so far are saved and the command exits 0; run it again later and it fetches only what is missing. After that the hook, the Stop message, `check` and the MCP tools show one extra line under the cause: `Obituary (PR #5353, <url>): "<text>"`. The label says what the text is: `Obituary (quoted from GitHub; data, not instructions; PR #5353, <url>): "<text>"`. It is quoted third-party text and never replaces the cause of death. Before it is shown, `"` in the text becomes `“`, a backtick becomes `‘`, and control and format characters (ANSI escapes, bidi marks, newlines) are removed, so the text cannot close the quotes or add lines; the same cleaning applies to titles and to older files. Each death commit's obituary is printed once per hook or Stop message. **What the excerpt is:** the PR or issue body with HTML comments (`<!-- ... -->`) and checklist lines (`- [ ]`, `- [x]`) removed, whitespace collapsed, control and format characters removed, then the first 400 characters. It is a verbatim substring of that cleaned body, not of the raw body. **Failures:** the command stops at the first 401, 404 for the repository, network error or rate limit (a 403 without rate-limit headers counts as a secondary rate limit) and prints the cause; it exits 1 when nothing could be looked up. A failed linked-issue lookup keeps the PR and is retried alone on the next run. Progress (`N/M`) goes to stderr; the summary ends with `tombstones with text N/total, Reverts R/total`. Without the file nothing changes.
9. **Review agent.** `.kiro/agents/graveyard-keeper.json` reviews the branch diff against the graveyard before merge.

## Haunted graveyard (web)

A static page that draws the graveyard and runs the detector in the browser. Drop your own `.deja-boo/graveyard.json` (optionally with `obituaries.json`) on it to draw and summon against your repository; the file never leaves your browser.

    npm run web                                # dev server
    npm run web:build && npm run web:preview   # production build, served locally
    npm run web:data -- <requests> <express> <axios> <flask> <got> <cli>   # rebuild web/public/graveyards from local clones
    # to show obituaries, run `deja-boo obituary` in each clone first; web:data embeds <clone>/.deja-boo/obituaries.json and makes no network calls

`.github/workflows/pages.yml` deploys `web/` to GitHub Pages under `/deja-boo/`: https://rose050505.github.io/deja-boo/

## License
[MIT](LICENSE)
