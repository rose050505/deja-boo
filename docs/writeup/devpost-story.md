## Inspiration

Teams delete code on purpose. A function leaked memory, a shortcut raced, a "simplification" broke uploads. The reason lives in a commit message or a pull request that nobody rereads.

AI coding agents rarely go looking for it. We tested this on real history:
- We checked out psf/requests as it was in April 2023: 6,143 commits.
- We asked Kiro to *"simplify HTTPAdapter.send(): drop the hand-rolled chunked upload loop and let urllib3 do chunked encoding"* (the exact prompt).
- Kiro rewrote exactly the code requests had **reverted in 2020**, and reported success. It didn't check the history first.

We also measured how common this is, and checked our own numbers by hand:
- In 6 popular repositories (axios, httpie, express, flask, got, requests; **19,908 commits**), deleted code came back more than a week after its death **26 times** (one count per commit).
- Each one was checked in git, one by one: **20 are real**, including all 7 that came back through a Revert. The hand labels are in [`research/labels/`](https://github.com/rose050505/deja-boo/tree/main/research/labels).
- An earlier version of our miner reported 50; a hand check found only 20 real, mostly because reformats and moves looked like deaths. We fixed the miner, not the claim.

Both directions matter:
- Sometimes the dead should stay dead.
- Sometimes the reason they died is gone. requests re-landed that same change in 2023, after review, when it needed full urllib3 2.0 support (#6226).

You can only make that call if someone shows you the tombstone.

## What it does

Déjà Boo turns git history into a **graveyard** and guards it.

1. **Bury.** `deja-boo index` mines `git log -p` for deleted blocks. Each becomes a *tombstone*:
   - a winnowing fingerprint (MOSS-style), the date and the commit
   - the **cause of death**: the commit message verbatim, plus linked issues and PRs. When history records no reason, it says so instead of guessing.
   - an optional **obituary** (`deja-boo obituary`): the opening text of the pull request or linked issue behind the death commit, quoted verbatim from GitHub. Reverts rarely explain themselves in the commit; with obituaries, Reverts that carry a written reason went from 37 to 57 of 71 in our 6 repos.

   These do **not** count as deaths: moves, reformatting, short-lived churn, and code that is still alive at HEAD (except Reverts).
2. **Watch.** Two Kiro hooks guard every change.
   - A `PreToolUse` hook checks each file write before it lands.
   - A `Stop` hook diffs the whole session's changes before the agent reports back. This catches shell edits too.

   Both slide a window over the new code. They fire only when the change makes the file *more* like a tombstone, so unrelated edits stay silent.
3. **Haunt.** When a change resurrects a tombstone, the agent is stopped with evidence. Example: *"👻 this code was buried on 2020-02-18 in 24bcb9e: Revert 'Use urllib for chunked requests'. Obituary (PR #5353): 'A number of PRs were merged back in September without any proper review… I'm going to revert for now to get 2.23.0 out the door'. Similarity 0.95, lines 486-498."*
   - The agent reads the full tombstone through the **Déjà Boo MCP server**.
   - Then it either takes another path, or, if the reason no longer applies, writes `deja-boo: checked <id>` next to the code and explains why. The decision leaves a trail in the code.
4. **See.** The **haunted graveyard** web app draws 6 repositories' graveyards over time. Revert deaths get cracked stones.
   - Click a stone to read the deleted lines and the commit.
   - Paste a snippet and the same matcher checks it against these graveyards in your browser. If the code has died there before, its stone shakes and a ghost rises with the evidence. For your own repository, use the CLI.

Déjà Boo ships as a **Kiro Power**: an MCP server, the skill *check-before-resurrecting*, and copy-ready guard hooks. It also includes a `graveyard-keeper` custom agent that reviews a branch before merge.

## How we built it

Everything was built with Kiro, spec by spec: 4 specs, 6 steering docs, 4 hooks, an MCP server, a Power and a custom agent. Details are in "How we used Kiro" below, and the logs of all 29 headless Kiro runs are in [`docs/kiro-runs/`](https://github.com/rose050505/deja-boo/tree/main/docs/kiro-runs).

- **Stack.** TypeScript (strict, ESM). There is no git library: we stream `git log -p --reverse --topo-order` from the git binary.
- **One matcher everywhere.** `src/core` (normalize, tokenize, winnow, windowed Jaccard) is browser-safe. The CLI, both hooks, the MCP server and the web app share the same matcher.
- **617 tests** with Vitest and fast-check, many of them properties.
- **Measured thresholds.** Our steering forbids guessing thresholds. We evaluated on 6 real graveyards ([`research/matching-eval.md`](https://github.com/rose050505/deja-boo/blob/main/research/matching-eval.md)):

| Case (synthetic mutations of real tombstones; see `research/matching-eval.md` for each sample) | First version | Shipped |
|---|---|---|
| One renamed identifier, recall at 0.6 | 37% | 85% |
| Two to four renamed identifiers, reaching warn | — | 91% |
| Dead block inside a larger write, recall at 0.5 | 1.8% | 85% |
| Demo fixture `haunted-http`, similarity | 0.05 (silent) | 0.94 (block) |
| Real requests 2023 re-landing (real history) | missed | blocked |
| Unrelated tombstone pairs, false alarms | — | 0 of 1,745 |

## Challenges we ran into

- **Agents don't use the door you guard.** With only a write hook, Kiro still re-made the reverted change, because it edited the file through shell commands. A probe showed that a `Stop` hook returning `{"decision":"block"}` makes the agent take another turn. So we added a Stop-time diff guard, with a loop guard so the agent can never get stuck.
- **Hooks only talk when they block.** In headless Kiro CLI, a non-blocking hook's output never reaches the agent. So "warn" became "block with evidence, accept an explicit acknowledgement", and that turned out to be the better product.
- **Real reverts differ by one line.** The 2020 requests revert removed one decisive line, `chunked=chunked`. Everything else matched live code, so the similarity barely moved (0.90 → 0.95). We now also check whether a write brings back the tombstone's *distinctive* fingerprint.
- **Real history is not like test data.** Property tests with monotonic dates passed. Then express produced revivals dated *before* their death, because merged branches make dates go backwards.

## Accomplishments that we're proud of

- **End to end on real history.** On the real requests history, the guard stopped Kiro with the tombstone and its obituary (PR #5353: merged without proper review, reverted to ship 2.23.0). Kiro read the tombstone, opened the PR and one of the issues it names (#4965). It could not confirm that the issues the revert left open had been fixed, so it took back its own change and asked us to choose: leave it, investigate the open issues first, or accept the risk. In other recorded runs it made other careful calls (keep with an acknowledgement and a test warning; revert and ask). The rehearsal is in `docs/kiro-runs/` and the video takes in `docs/kiro-runs/video-takes/`; in none did it resurrect the code silently.
- **Real bugs caught by property-based testing**, each written up with its counterexample in [`research/pbt-findings.md`](https://github.com/rose050505/deja-boo/blob/main/research/pbt-findings.md).
- **Every message is evidence.** Each one carries only facts from git history or verbatim GitHub text, and "no reason recorded" is a valid answer.
- **We reviewed our own claims.** Independent reviews replayed the tool on three repos it was never tuned on (click, black, koa): blocks of four or more lines that come back were caught 8 of 9 times, ordinary writes alarmed about 1 in 200, and a 4,000-line file now checks in about 100 ms instead of 4 s.

## What we learned

Spec-driven development paid off most where we had *evidence*. Every review round started from a measurement or a rehearsal on a real repository, not from opinion, and Kiro's specs made each round cheap to apply.

## What's next

- A GitHub Action built on the `graveyard-keeper` agent.
- Cross-repository graveyards for monorepos and forks.
- Learning per-team thresholds from acknowledged tombstones.

## How we used Kiro

### Kiro surfaces: IDE, CLI, Web, Crew

**Kiro CLI 3.5.0 (v3 engine), headless, for all generation and implementation.** Every spec was generated and every task batch was executed with:

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools "<prompt>"
```

- In total there were 29 headless runs (2 of them `--resume` continuations): the 4 specs (graveyard-miner, revenant-watch, haunted-graveyard, obituary), the Power, the custom agent, two web fixes found while recording the video, a design change from the video review that was later reverted, and four rounds of fixes from independent functional reviews (real use on click/black/koa, hand-labelled accuracy). Plus 4 rehearsal runs and 7 recorded takes for the demo video. Each batch had to end with `npm test` and `tsc --noEmit` green before the next one started. Test counts went 45 → 130 → 175 → 177 → 220 → 224 → 256 → 284 → 297 → 331 → 339 → 341 → 343 → 346 → 410 → 438 → 536 → 563 → 583 → 617.
- One run was killed mid-task. `kiro-cli chat --resume` continued the same conversation and finished it cleanly.
- The logs of every run, with the reviewer prompts where a run was started from one, are in [`docs/kiro-runs/`](https://github.com/rose050505/deja-boo/tree/main/docs/kiro-runs).

**Kiro CLI as the demo stage.** We also used headless Kiro *as the test subject*: real-repository rehearsals with and without our hooks. That is how we found that the agent edits files through shell commands, which bypasses write hooks.

**Kiro IDE 1.5.** We used it to read specs and steering. The IDE extracts correctness properties from EARS requirements and generates property tests for them. The CLI does not, so we wrote down the property tests we wanted in the `testing` steering doc and asked for them in each spec.

**Human in the loop.** Kiro wrote all product code. A second AI (Claude Code) acted only as a reviewer: it read each spec, ran rehearsals and measurements on real repositories, and sent review comments back to Kiro as prompts.

### Spec-driven development

**`graveyard-miner`: git history → tombstones.**
- It started with 13 EARS requirements → 19 tasks.
- Then came two rounds of post-review fixes, each recorded in `tasks.md`.

**`revenant-watch`: matcher, `check`, hooks, MCP.**
- It started with 9 requirements → 12 tasks. A 10th requirement and tasks 13–15 came later for the Stop guard, plus a packaging section.
- Four review rounds each came from an end-to-end finding:
  1. The "new lines only" rule would miss the demo.
  2. A line diff aligned the rewrite to live code.
  3. A one-line real revert slipped under the +0.1 margin.
  4. Kiro edited through the shell.

**`haunted-graveyard`: the web app.** 9 tasks, from the data script to the Pages workflow.

**`obituary`: the reason behind a death.** Written after a functional review measured that 56–80% of tombstones carry no reason (by repo) and that the demo's 2020 revert explains itself only in its pull request (#5353). 9 EARS requirements → 15 tasks in 5 batches, including a measured change to one shared Revert predicate, an injected GitHub fetcher so tests never touch the network, and a real-history acceptance test: the Stop block on the requests scene must quote PR #5353.

**Compared with vibe coding.** A finding like "the hook misses the real requests case" became a requirement change, a design change, new tasks and new properties in one pass, with the measured numbers pasted into the spec. We never had to re-explain the system, and the specs now document *why* each rule exists.

### Steering

There are six steering docs:

| Doc | Inclusion | Content |
|---|---|---|
| `product` | always | product brief |
| `tech` | always | stack, browser-safe core, determinism, performance targets |
| `structure` | always | the Tombstone and Revenant records |
| `evidence-first` | always | never invent a cause of death; thresholds must come from measurements in `research/`; when unsure, warn |
| `ghost-voice` | fileMatch | palette, tone, reduced motion |
| `testing` | fileMatch | which property tests every core function needs |

`evidence-first` did the most work.
- Kiro kept every user-facing message to facts from git history.
- Kiro also wrote the threshold rule into the spec itself: "Any change to the defaults requires new numbers in `research/`". Our evaluation on 6 real graveyards (`research/matching-eval.md`) exists because of that rule.

### Agent hooks

**The product is two hooks.**

| Hook | What it does |
|---|---|
| `deja-boo-guard` (PreToolUse, matcher `write`) | blocks a file write that resurrects a tombstone: exit 2, with the evidence on stderr |
| `deja-boo-stop-guard` (Stop) | diffs the session's changes against HEAD when the agent finishes, and returns `{"decision":"block","reason":…}`, so the agent takes another turn with the evidence. A per-session loop guard keeps it from trapping the agent |

**We probed Kiro's hook behavior before designing.** We used logging hooks in empty workspaces.

What we learned about stdin:
- `fs_write` sends `{path, text}`.
- `str_replace` sends `{path, oldStr, newStr, replace_all}`.

What we learned about which output reaches a headless agent:

| Hook output | Reaches the agent? |
|---|---|
| exit 2 + stderr | ✅ |
| Stop with `decision: block` | ✅ |
| exit 0 stdout, exit 1, structured `permissionDecisionReason`, PostToolUse output | ❌ |

That shaped the whole design: block with evidence, and accept an explicit in-code acknowledgement.

**Development hooks.** Both are command hooks, so they cost no credits.
- `session-brief` (SessionStart) tells the agent how many tombstones the repo has, and to call `check_snippet` before re-adding removed code.
- `test-on-save` (PostFileSave on `src/**/*.ts`) runs `vitest --changed`.

### MCP

The Déjà Boo MCP server (`@modelcontextprotocol/sdk`, stdio) offers three tools:
- `check_snippet`
- `get_tombstone`
- `list_graveyard`

It is registered in `.kiro/settings/mcp.json`, so the repo dogfoods it.

**In the real-history rehearsal**, Kiro followed this sequence:
1. The Stop guard blocked Kiro.
2. Kiro loaded `@deja-boo/get_tombstone` by itself and read the tombstone.
3. Kiro noted that the 2020 revert recorded no reason.
4. Kiro kept the change with `deja-boo: checked <id>` and told us to test chunked uploads on the supported urllib3 versions.

In the four guarded takes recorded for the video, the same sequence ended differently: twice Kiro backed out its change and asked; once it kept the change pending, refused to add the marker without a reason, and asked; and in the take used in the final video, with the obituary in the block message, it opened PR #5353 and issue #4965, could not confirm the open issues were fixed, reverted its change and offered three options. Every outcome came from reading the tombstone first. All takes are in `docs/kiro-runs/video-takes/`.

### Property-based testing

fast-check properties caught real implementation bugs, each with its counterexample in `research/pbt-findings.md`; some findings there were fixes to the tests themselves. Some examples:
- **Normalization was not idempotent.** The first fix corrupted code like `--count;`, and a new property now guards it.
- **Same-day tombstones were dropped** when `graceDays` was 0.
- **The orchestrator processed commits newest-first**, which silently broke revival tracking.

**One bug only real history could reveal.** "Revivals are later than their death" passed on synthetic dates but failed on express, because merged branches make dates go backwards. The fix added a fixture repo with a backdated side branch and a property with non-monotonic dates.

**Spec 2 properties.**
- Renaming one identifier keeps windowed similarity ≥ 0.6.
- An exact prefilter (27 s → 7–15 ms for 1,500 tombstones) never changes results.
- Writing the post-write text back unchanged never fires.
- Acknowledging every id always passes.
- Tombstones alive at HEAD are never reported unless they are Reverts.

### Custom agents

`.kiro/agents/graveyard-keeper.json` reviews a branch's diff against the graveyard before merge.
- **Tools:** read, shell, and the Déjà Boo MCP tools.
- **Shell access:** limited to `git` and the deja-boo CLI.
- **Resources:** the steering docs.

### Kiro Powers

`power/` is in the Agent Plugins format:
- `plugin.json`, with activation keywords such as *revert*, *regression* and *why was this removed*
- `mcp.json`, which starts the server with `npx -y github:rose050505/deja-boo mcp` (no npm publish needed; a `prepare` script builds on install)
- the skill `check-before-resurrecting`
- copy-ready guard hooks

Install it with `kiro-cli powers install ./power`, or in the IDE under Powers → Add Custom Power → Import power from a folder.
