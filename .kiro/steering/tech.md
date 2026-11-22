---
inclusion: always
---

# Tech stack

- **Language:** TypeScript (strict), ESM, Node.js 24.
- **Package manager:** npm. Keep dependencies few and well known.
- **Tests:** Vitest + **fast-check** for property-based tests. Every pure function in `src/core` gets at least one property test.
- **Git access:** spawn the local `git` binary (`git log -p --no-merges --no-color --format=...`). Do not add a git library.
- **MCP:** `@modelcontextprotocol/sdk`, stdio transport.
- **Web UI:** Vite + TypeScript, no heavy framework. SVG/CSS animation for the graveyard. Must work as a static site (GitHub Pages) by loading prebuilt graveyard JSON.
- **Core must be browser-safe:** `src/core` (normalize, fingerprint, match) has no Node imports so the web UI can reuse it. Only `src/miner` touches `child_process` / `fs`.

## Constraints
- No network calls and no secrets in the core. Optional LLM features must be off by default and read keys only from environment variables.
- Deterministic output: the same repo and options always produce the same graveyard JSON (sorted keys, stable ids).
- Performance target: index a 5,000-commit repo in under 60 seconds on a laptop; a `check` call answers in under 200 ms.

## Commands
- `npm test` — unit + property tests
- `npm run build` — compile CLI and MCP server to `dist/`
- `npm run web` — dev server for the graveyard UI
