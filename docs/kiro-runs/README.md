# Kiro CLI run logs

Every product change in this repository was made by Kiro CLI 3.5.0 (v3 engine) running headless:

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools "<prompt>"
```

This folder keeps the console output of those runs, together with the reviewer prompts that started them.
- `*.md` files are prompts written by the reviewer (Claude Code).
- `*.log` files are Kiro's output. Each `[tool]` line is one tool call by the agent.
- Nothing was edited, except that one opaque request id in a throttling error was replaced with `<request-id redacted>`.

## Spec 1: `graveyard-miner`

| Log | Prompt | What Kiro did |
|---|---|---|
| `spec1_create.log` | (inline) | Generated requirements, design and tasks |
| `spec1_revise.log` | `spec1_review.md` | Revised the spec after review |
| `spec1_tasks1-4.log` | (inline) | Tasks 1-4 |
| `spec1_tasks5-11.log` | (inline) | Tasks 5-11 |
| `spec1_tasks12-17.log` | (inline) | Tasks 12-17 |
| `spec1_review2_fix.log` | `spec1_review2.md` | Fixes after a smoke test on expressjs/express (hit a rate limit) |
| `spec1_review2_fix_resume.log` | (`--resume`) | Same conversation, resumed and finished |
| `r0_review3_fix.log` | `next_review.md` | Third review round: punctuation-aware tokens, windowed matching, skip list, alive-at-HEAD filter, new properties |
| `r0b_revert_alive.log` | (inline) | Revert tombstones stay watched even when alive at HEAD |

## Spec 2: `revenant-watch`

| Log | Prompt | What Kiro did |
|---|---|---|
| `r1_spec2_create.log` | (inline) | Generated the spec |
| `r2a_spec2_fix_batchAB.log` | `spec2_review.md` | Spec fixes, then tasks batches A-B |
| `r2b_batchCD.log` | `r2b_prompt.md` | Batches C-D: hook decision, hook entry point, MCP handlers |
| `r2c_fix_batchEF.log` | `r2c_prompt.md` | Fixed the "write makes it worse" rule, batches E-F |
| `r2d_distinct.log` | `r2d_prompt.md` | Distinct-fingerprint recovery for the real requests re-landing |
| `r2e_stop_hook.log` | `r2e_prompt.md` | Stop-time diff guard (requirement 10, tasks 13-15) |

## Spec 3: `haunted-graveyard`, and Kiro extensions

| Log | Prompt | What Kiro did |
|---|---|---|
| `r3_web.log` | (inline) | The web app (the run was killed mid-task) |
| `r3_web_resume.log` | (`--resume`) | Same conversation, resumed and committed |
| `r4_power_agent_hooks.log` | (inline) | Kiro Power, `graveyard-keeper` agent, development hooks |
| `r4b_agent_v3.log` | (inline) | Rewrote the agent in the V3 `permissions` format |
| `r5_web_overflow.log` | `r5_web_overflow_prompt.md` | Fixed sideways page scroll on the live demo (found while recording the video) |
| `r6_web_ghost.log` | `r6_web_ghost_prompt.md` | Ghost no longer clipped in small graveyards; caption resets on repo change (found while recording the video) |

## Rehearsals: Kiro as the test subject

The first three runs used psf/requests checked out at `26bea1e4^` (April 2023). The prompt was:
*"simplify `HTTPAdapter.send()` … let urllib3 do chunked encoding"*.

| Log | Setup | Result |
|---|---|---|
| `rehearsal_requests2023_noguard.log` | no Déjà Boo | Kiro re-made the change requests reverted in 2020 |
| `rehearsal_requests2023_writehook_only.log` | write hook only | Kiro edited through shell commands, so the write hook never saw it |
| `rehearsal_requests2023_guarded.log` (+ `.diff`) | write hook + Stop guard | Kiro was stopped and read the tombstone. It kept the change with `deja-boo: checked <id>` and a test warning |
| `rehearsal_hauntedhttp_noguard.log` | demo fixture `haunted-http`, no guard | Kiro read `git log` by itself and declined, because the fixture's revert message states the reason. Real history is rarely that explicit: the 2020 requests revert gives none, which is why the real-repo rehearsals above matter |
