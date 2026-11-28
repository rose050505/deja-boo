# How we used Kiro

## Kiro surfaces: IDE, CLI, Web, Crew

**Kiro CLI 3.5.0 (v3 engine), headless, for all generation and implementation.** Every spec was generated and every task batch was executed with:

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools "<prompt>"
```

- In total there were 35 headless runs (3 of them `--resume` continuations): the 4 specs (graveyard-miner, revenant-watch, haunted-graveyard, obituary), the Power, the custom agent, two web fixes found while recording the video, a design change from the video review that was later reverted, four rounds of fixes from independent functional reviews (real use on click/black/koa, hand-labelled accuracy), and a final round after comparing our page with other entries and a tester's feedback (the real requests case as the demo, a first screen for judges, the moment it blocks, opening your own graveyard on the page, `index` listing your comebacks). Plus 4 rehearsal runs and 7 recorded takes for the demo video. Each batch had to end with `npm test` and `tsc --noEmit` green before the next one started. Test counts went 45 → 130 → 175 → 177 → 220 → 224 → 256 → 284 → 297 → 331 → 339 → 341 → 343 → 346 → 410 → 438 → 536 → 563 → 583 → 617 → 619 → 630 → 655 → 674 → 690.
- One run was killed mid-task. `kiro-cli chat --resume` continued the same conversation and finished it cleanly.
- The logs of every run, with the reviewer prompts where a run was started from one, are in [`docs/kiro-runs/`](https://github.com/rose050505/deja-boo/tree/main/docs/kiro-runs).

**Kiro CLI as the demo stage.** We also used headless Kiro *as the test subject*: real-repository rehearsals with and without our hooks. That is how we found that the agent edits files through shell commands, which bypasses write hooks.

**Kiro IDE 1.5.** We used it to read specs and steering. The IDE extracts correctness properties from EARS requirements and generates property tests for them. The CLI does not, so we wrote down the property tests we wanted in the `testing` steering doc and asked for them in each spec.

**Human in the loop.** Kiro wrote all product code. A second AI (Claude Code) acted only as a reviewer: it read each spec, ran rehearsals and measurements on real repositories, and sent review comments back to Kiro as prompts.

## Spec-driven development

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

## Steering

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

## Agent hooks

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

## MCP

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

## Property-based testing

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

## Custom agents

`.kiro/agents/graveyard-keeper.json` reviews a branch's diff against the graveyard before merge.
- **Tools:** read, shell, and the Déjà Boo MCP tools.
- **Shell access:** limited to `git` and the deja-boo CLI.
- **Resources:** the steering docs.

## Kiro Powers

`power/` is in the Agent Plugins format:
- `plugin.json`, with activation keywords such as *revert*, *regression* and *why was this removed*
- `mcp.json`, which starts the server with `npx -y github:rose050505/deja-boo mcp` (no npm publish needed; a `prepare` script builds on install)
- the skill `check-before-resurrecting`
- copy-ready guard hooks

Install it with `kiro-cli powers install ./power`, or in the IDE under Powers → Add Custom Power → Import power from a folder.
