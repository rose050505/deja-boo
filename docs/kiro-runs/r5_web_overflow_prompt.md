Reviewer: a layout bug on the live web demo (https://rose050505.github.io/deja-boo/), found while recording the demo video.

At a 1920x1080 viewport the whole page scrolls sideways: document width is 2810px, and #gy-scroll is 2750px wide with clientWidth 2750, so its `overflow: auto` never engages. The graveyard should scroll inside its own box, and the header and stats should stay put.

Likely cause: `main { display: grid }` in web/src/style.css has an implicit `auto` column, and grid items default to `min-width: auto`, so the wide .gy-inner (inline width 2750px) stretches the column. Something like `grid-template-columns: minmax(0, 1fr)` on main (or `min-width: 0` on the section) should fix it. Please confirm the cause yourself before changing it.

Done means:
- At 1920 and at 375 px widths, the page has no horizontal scroll (document.scrollingElement.scrollWidth <= innerWidth), and #gy-scroll scrolls horizontally on its own.
- Add a regression check if one fits the existing tests (web/src/layout.test.ts or similar). If a DOM-level check isn't practical in vitest, say so.
- `npm test`, `npx tsc --noEmit` and `npm run web:build` pass. Commit with a message ending in "(Kiro CLI)". Don't push.
