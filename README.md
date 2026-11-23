# 👻 Déjà Boo

**Your codebase remembers what it buried.**

AI coding agents don't read git history. Ask one to "add caching" and it may happily re-create the exact code your team deleted months ago because it leaked memory. Déjà Boo mines your git history for deleted code (*tombstones*), and when an agent or a human is about to write that code again (*a revenant*), it raises a ghost with the evidence: when it died, why, and in which commit.

> 🎃 Built for **Kiroween 2026** (Costume Contest) with [Kiro](https://kiro.dev): specs, steering, hooks, MCP, property-based tests, and a Kiro Power.

## Status
🚧 Work in progress (Kiroween 2026 runs until Dec 4).
- ✅ **Graveyard miner** (`deja-boo index`): spec [`graveyard-miner`](.kiro/specs/graveyard-miner/), 177 unit + property tests. Indexes express (5,701 commits) in 1.7 s.
- 🔜 **Revenant watch**: `check`, the Kiro `PreToolUse` guard hook, and the MCP server.
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

## License
[MIT](LICENSE)
