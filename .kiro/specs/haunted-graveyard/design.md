# Haunted Graveyard: Design

## Layout
```
web/
  index.html  vite.config.ts  tsconfig.json
  scripts/build-data.ts      # npm run web:data -- <requests> <express> <axios> <flask> <got> <cli>
  scripts/strip.ts           # pure: stripTombstone, repoStats (tested)
  src/main.ts                # wiring
  src/data.ts                # load graveyard JSON, types
  src/layout.ts              # pure: stone positions, epitaph, sizes (tested)
  src/graveyard-view.ts      # SVG stones + detail dialog
  src/summon.ts              # pure: summon(graveyard, text) + panel DOM
  src/demo-snippet.ts        # the haunted chunked upload
  src/style.css  src/contrast.test.ts
  public/graveyards/*.json  public/stats.json
```
Vitest include widens to `web/**/*.test.ts`; `tsc -p web` is a separate check (`npm run web:check`).

## Data script
1. `npm run build` (so `dist/` exists). Node 24 runs `web/scripts/build-data.ts` directly (type stripping), importing `dist/core` for `fingerprintLines`.
2. For each clone: `node dist/cli/main.js index <clone> --out <tmp>/<name>.json`, read, strip, write with sorted keys.
3. `haunted-http`: `bash src/test-fixtures/haunted-http.sh <tmp>/haunted-http` then index.
4. Stats: sum `commits`, `tombstones`, `revivals`, `revivalsViaRevert`; median gap = the median of per-repo medians weighted by revival count is wrong, so the stats come from all revival gaps: gap = revival date − tombstone `buriedAt`, over revivals the CLI counted (not merge artifacts).
5. Fail when a file is 3 MB or more.

## Stone layout
x = linear in `buriedAt` over the graveyard's span, padded. Rows = top-level directory (first path segment, or `(root)`), sorted by stone count desc then name. Stones in a row that collide in x are stacked into sub-lanes by greedy packing. Stone width/height = f(sqrt(lines)), clamped. Pure and tested: positions are inside the canvas, same input gives same layout, bigger lines never gives a smaller stone.

## Summon
`summon(graveyard, text)` = split lines, `findRevenants(graveyard, lines, DEFAULT thresholds)`, drop `acknowledgedIds(text)`. It returns `{hits, rested}`. The DOM layer renders ghosts and sets a `haunted` class on stones.

## Motion and contrast
CSS animations sit under `@media (prefers-reduced-motion: no-preference)`. The reduce case uses a fixed outline and static opacity. A unit test computes contrast of palette pairs.
