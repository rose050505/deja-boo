# Haunted Graveyard: Tasks

Each batch ends with `npm test`, `npx tsc --noEmit` and `npm run web:check` green. Tick `[x]` when done.

## Batch A: data
### [x] Task 1: Web scaffold (vite config, tsconfig, vitest include, scripts)
### [x] Task 2: `strip.ts` with tests (field set, cap + fingerprint recompute, alive drop except Revert, determinism)
### [x] Task 3: `build-data.ts`; run it; commit JSON; all files < 3 MB
## Batch B: view
### [x] Task 4: `layout.ts` with tests; `data.ts`
### [x] Task 5: graveyard SVG, epitaphs, cracked Revert stones, detail dialog, stats strip
## Batch C: summon
### [x] Task 6: `summon.ts` with tests (demo snippet hits the Revert stone, acknowledged ids rest)
### [x] Task 7: summon panel, ghosts, shake, fog, demo button
## Batch D: polish and deploy
### [x] Task 8: CSS, reduced motion, contrast test
### [x] Task 9: `pages.yml`; production build; `vite preview` smoke check

## Batch E: judge path
### [x] Task 10: E1 real requests demo (`demo-snippet.ts`, `DEMO_REPO = 'requests'`, button text, `summon.test.ts` asserts a36a5b61502a at block; the haunted-http fixture still raises its stone; fixture chip labelled and last)
### [x] Task 11: E2 header links, Open Graph / Twitter card meta, `web/public/og.jpg`
## Batch F: first screen
### [x] Task 12: F1 hero (sentence, subline, demo button, video link) above the fold at 1440x900 and 375 px
  Note: hero sentence, subline, demo button and video link in `index.html`; measured in headless Chrome: hero, stats and judges end at y=589 at 1440x900, hero and stats end at y=641 at 375 px.
### [x] Task 13: F2 three headline numbers from `stats.json` and README-quoted numbers with evidence links; "How we counted" collapsed block
  Note: `first-screen.ts` `headlineNumbers` reads `stats.json`; `CONFIRMED_REAL = 20` is the only constant (README line, `research/labels/`); test checks both; other numbers in collapsed `#how-counted` with old wording.
### [x] Task 14: F3 requests opens scrolled to the 2020 Revert stone with a visible label
  Note: `initialStoneId` + scroll in `mountGraveyard` + non-blocking `.stone-label` (pointer-events none); test for the target.
### [x] Task 15: F4 "For judges" three-step strip
  Note: `.judges` ordered list with video, demo link, `npx ... index` / `check <file>`, README setup link.
### [x] Task 16: F5 epitaph next to the hovered or focused stone
  Note: `.tip` tooltip on hover and focus, Esc and scroll hide it, native `<title>` removed to avoid a double tooltip; `tooltipFor` and `tipPosition` tested.
## Batch G: the moment it blocks
### [x] Task 17: G1 scroll, shake, large ghost, red edge tint, BLOCKED / WARN stamp, evidence card beside the graveyard
  Note: first ghost 3.5x (`moment.ts`), 1 s edge flash then steady 0.28 red for blocks only, stamp text is real DOM text, lead card in `#gy-evidence` beside the graveyard (under it below 1100px); at 1440x900 stone and card end at y=766.
### [x] Task 18: G2 CSS/SVG atmosphere, always-on fog, committed OFL display font
  Note: sky gradient, moon, 2 twinkling star groups, shaded stones, grass strip per row, always-on drifting `.fog-base`; Cinzel (OFL 1.1) in `web/public/fonts/` with licence.
### [x] Task 19: G3 opt-in synthesized sound (default off)
  Note: `sound.ts`, header toggle "Sound: off", saved in localStorage, Web Audio swell + chime created only after opt-in; tested with a stub.
## Batch H: your own graveyard
### [x] Task 20: H1 drop / pick `.deja-boo/graveyard.json`, validate, draw, summon target; express-size file without freezing; malformed file changes nothing
  Note: `your-graveyard.ts` validates, then converts with `stripGraveyard` (equals the committed haunted-http.json in a test); drop zone, picker, folder drop, optional obituaries.json, optional validated owner/name in `main.ts`; a 5 MB file converts and lays out in under 1 s in a test, "Reading…" shows first; not checked in a browser (this machine's Chrome policy blocks localhost).
### [x] Task 21: reduced motion, text equivalents and contrast test for all new states and colours (applies to F, G, H)
  Note: audited F, G, H and the review fixes. Added: drop zone is `role="group"`; row labels carry the full name in `title`/`aria-label`; new tests in `web/src/review-fixes.test.ts` (decorative layers `aria-hidden`, verdict and caption live, stones are keyboard buttons, scrolling honours reduced motion, lead reason uses only checked palette colours). No new animation was added, so the existing contrast test and the "all animation under no-preference" test still cover everything. Checked in headless Chrome at 1440x900 and 375x812.
