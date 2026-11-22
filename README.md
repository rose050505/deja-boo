# 👻 Déjà Boo

**Your codebase remembers what it buried.**

AI coding agents don't read git history. Ask one to "add caching" and it may happily re-create the exact code your team deleted months ago because it leaked memory. Déjà Boo mines your git history for deleted code (*tombstones*), and when an agent or a human is about to write that code again (*a revenant*), it raises a ghost with the evidence: when it died, why, and in which commit.

> 🎃 Built for **Kiroween 2026** (Costume Contest) with [Kiro](https://kiro.dev): specs, steering, hooks, MCP, property-based tests, and a Kiro Power.

## Status
🚧 Work in progress. See [`.kiro/steering/product.md`](.kiro/steering/product.md) for the product brief.

## Why it matters
A quick probe of 6 popular open-source repos (~20k commits) found **81 times** deleted code came back more than a week later, **70** of them rewritten rather than reverted, with a median gap of several months. That was before AI agents started writing most of the code.

## License
[MIT](LICENSE)
