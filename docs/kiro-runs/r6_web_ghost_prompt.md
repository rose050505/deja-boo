Reviewer: two visible bugs in the web demo's "Try the haunted chunked upload" flow, found while recording the demo video on the live site (1920x1080).

1. The ghost is clipped. After the demo switches to haunted-http (1 tombstone), the graveyard is a single short row. The haunted stone gets its green outline, but the ghost glyph drawn above it (y around -40 in ghostGlyph, web/src/graveyard-view.ts) is cut off by the SVG/row bounds, so only a sliver shows. The same will happen to stones in the top row of any repo. Give the graveyard enough headroom that a ghost above any stone, including the top row of a one-row graveyard, is fully visible (for example top padding in the layout, or overflow visible plus a minimum height). Keep the layout tests meaningful.

2. The caption is stale. #gy-caption keeps the epitaph of the last stone hovered in the previous repo (for example "Farewell, sweet Concorde! · 2022-03-25 · requests/compat.py" while haunted-http is shown). When the repo changes, reset the caption to the default "Hover or focus a stone to read its epitaph." When the demo haunts a stone, it would be even better for the caption to show that stone's epitaph.

Done means: both fixed, with a unit test where practical. `npm test`, `npx tsc --noEmit` and `npm run web:build` pass. Commit with a message ending in "(Kiro CLI)". Don't push.
