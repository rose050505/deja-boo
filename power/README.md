# Déjà Boo power

Your codebase remembers what it buried. This power gives a Kiro agent three MCP tools (`check_snippet`, `get_tombstone`, `list_graveyard`) and a skill that tells it to check the graveyard before re-adding removed code.

## Install

- CLI: `kiro-cli powers install ./power`
- IDE: Powers panel -> Add Custom Power -> Import power from a folder, then pick `power/`.

The MCP server runs through `npx -y github:rose050505/deja-boo mcp`. The first run builds `dist/` from the GitHub checkout (the package has a `prepare` script), so it needs Node 24 and network access once.

## Build the graveyard

The tools read `.deja-boo/graveyard.json` in the project you open. Create it from that project's history:

    npx -y github:rose050505/deja-boo index

(In the deja-boo repository itself: `npm run bury`.) Rebuild it whenever history changes.

## Hooks

As far as the docs say, powers do not install hooks automatically. Copy the ready-made guard into your project:

    mkdir -p .kiro/hooks && cp power/hooks/deja-boo-guard.json .kiro/hooks/

It adds a `PreToolUse` hook on write tools and a `Stop` hook, both running `npx -y github:rose050505/deja-boo hook`. Exit 2 blocks with the evidence on stderr; a bad event exits 1, and a missing graveyard exits 0 after one line on stderr telling you to run `deja-boo index`. Neither blocks.

## Contents

- `plugin.json`, `mcp.json`: Agent Plugins manifest and MCP server.
- `skills/check-before-resurrecting/SKILL.md`: when to call the tools and how to acknowledge a tombstone (`deja-boo: checked <id>`).
- `hooks/deja-boo-guard.json`: the hooks to copy.
