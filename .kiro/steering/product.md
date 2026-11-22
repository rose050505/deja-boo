---
inclusion: always
---

# Product: Déjà Boo

**One line:** Your codebase remembers what it buried. Déjà Boo stops AI agents (and humans) from resurrecting code that was deliberately deleted, and tells them when and why it died.

## Problem
AI coding agents do not read git history. When asked to "add caching" or "handle retries", they happily re-create code that the team removed months ago because it leaked memory, raced, or broke production. Reviewers rarely remember the original reason either. The result: the same bug comes back as a *revenant*.

## Users
- Developers who pair with an AI agent (Kiro IDE / CLI) on an existing repository.
- Reviewers who need to know "was this tried before, and why did we remove it?"

## Core loop
1. **Bury** — mine `git log -p` for deleted code blocks. Each becomes a *tombstone* with its fingerprint, date, commit, author handle, and *cause of death* (commit message, linked PR/issue).
2. **Watch** — when new code is about to be written (Kiro `PreToolUse` hook on write tools) or is checked on demand (CLI / MCP), fingerprint it and look for matching tombstones.
3. **Haunt** — on a match, block or warn with evidence: "You buried this on 2026-03-02 — it leaked memory (PR #42)". The agent can then read the tombstone through MCP and choose a different approach.

## Surfaces
- `deja-boo` CLI (index, check, hook adapter)
- MCP server (tools: `check_snippet`, `get_tombstone`, `list_graveyard`)
- Kiro Power bundle (MCP + skill + hook) for one-click install
- Haunted graveyard web UI (static site) where each tombstone is a deleted block and ghosts rise for matches

## Non-goals
- Not a dead-code finder (unreferenced functions). We care about code that *died and is coming back*.
- No cloud service, no accounts, no API keys required for the core.

## Judging alignment (Kiroween 2026, Costume Contest)
Every feature should serve at least one: real developer impact, deep Kiro usage, polished spooky design that *is* the function, novelty, and a 3-minute demo that works end to end.
