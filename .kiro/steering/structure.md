---
inclusion: always
---

# Project structure

```
src/
  core/        # pure, browser-safe: normalize.ts, fingerprint.ts, match.ts, types.ts
  miner/       # git log parsing -> tombstones (Node only)
  cli/         # deja-boo index | check | hook
  mcp/         # MCP server exposing the graveyard to agents
web/           # haunted graveyard UI (Vite), reads web/public/graveyards/*.json
power/         # Kiro Power bundle: plugin.json, mcp.json, skills/
research/      # scripts and results for measuring revenants in public repos
.kiro/         # specs, steering, hooks (never gitignored)
```

## Conventions
- File names: kebab-case. Types and interfaces live in `src/core/types.ts`.
- A **Tombstone** is the central record: `{ id, fingerprint[], lines, path, language, buriedAt, commit, author, causeOfDeath, links[] }`.
- A **Revenant** is a match result: `{ tombstone, similarity, matchedLines }`.
- Keep functions small and pure; side effects only at the edges (miner, cli, mcp).
- Public functions get a one-line JSDoc that states the invariant a property test checks.
