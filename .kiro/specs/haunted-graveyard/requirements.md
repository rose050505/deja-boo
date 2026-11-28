# Haunted Graveyard: Requirements

## Overview

The haunted graveyard is a static web app in `web/` (Vite + TypeScript, no framework). It makes a mined graveyard visible and lets a judge paste code and see the detector run, with nothing installed. It reuses `src/core` unchanged (`findRevenants`, which calls `matchWindowedIndexed`, proven equal to `matchWindowed`; `hauntLevel`; the tokenizer). It follows `steering/ghost-voice.md` and `steering/evidence-first.md`.

Terms: a *stone* is one tombstone drawn on the graveyard. A *hit* is a `RevenantHit` from `findRevenants`.

## Requirements

### REQ-1: Graveyard data
**EARS:** When `npm run web:data -- <clones>` runs, the system shall write `web/public/graveyards/<repo>.json` for requests, express, axios, flask, got, httpie-cli and haunted-http.

- Each tombstone is stripped to `{id, path, language, buriedAt, commit, causeOfDeath, links, lines, fingerprint, revivals, aliveAtHead}`. Revival records are kept whole.
- Tombstones that are `aliveAtHead` are dropped, except Revert-caused ones, because `hauntLevel` keeps those watched (`level.ts`). The `aliveAtHead` field stays so `hauntLevel` gives the same answer as the CLI.
- `lines` is capped at 60. When a tombstone is capped, its `fingerprint` is recomputed from the kept lines with `fingerprintLines`, so window size and fingerprint agree, and the record carries `totalLines` (the true count). The UI says "showing 60 of N lines". Uncapped records have no `totalLines`.
- Each file is under 3 MB. The script fails when one is not.
- Output is deterministic: same clones, same bytes.
- Clones are arguments; nothing from them is committed. `haunted-http` is built with `src/test-fixtures/haunted-http.sh` into a temp dir that is removed afterwards.
- The script also writes `web/public/graveyards/index.json` (repo list with GitHub slug) and `web/public/stats.json` (numbers for the stats strip, measured by the CLI on the full, unstripped graveyards).

### REQ-2: Graveyard view
**EARS:** When a graveyard loads, the system shall draw one stone per tombstone, placed by time (x) and top-level directory (rows).

- Stone size grows with lines buried. Epitaph = first line of the cause of death + date. Empty cause reads "cause of death unknown".
- A Revert death gets a cracked stone, and the text "Revert" is also on it (no color-only state).
- Activating a stone (click, Enter or Space) opens the full tombstone: deleted lines, cause of death verbatim (all lines), commit hash with a GitHub link, links, revivals list (date, commit, similarity, Revert flag). Repos without a remote show the hash without a link.
- Every stone is keyboard reachable and has an accessible name with epitaph and date.
- With many stones the view stays usable: stones are positioned in one SVG, rows scroll vertically, time scrolls horizontally.

### REQ-3: Summon panel
**EARS:** When the visitor pastes code and presses Summon, the system shall run `findRevenants` in the browser against the selected graveyard with default thresholds.

- Matching stones shake; each hit raises a ghost whose opacity equals similarity, with similarity %, level text (`warn` or `block`), matched line range, matched lines highlighted in the pasted text, and evidence (id, commit, date, verbatim cause of death, links).
- Each hit shows: "If the reason no longer applies, let it rest: add `deja-boo: checked <id>`". `acknowledgedIds` is applied to the pasted text: acknowledged hits are listed as "rested" and do not rise.
- No hit: the text "Nothing rises. No buried code matches." Unsure results (warn) are labelled as warnings, not blocks.
- The button "Paste what Kiro wrote (real requests history)" pastes the real requests code, selects `requests` and summons. It must raise a36a5b61502a63ed9b4b2b875e7420e118a72156 at block with the obituary line. (Replaces "Try the haunted chunked upload", which used the haunted-http fixture; that repo stays as the last chip, labelled "(fixture)".)
- Fog density grows with the number of active hits (text count shown too).

### REQ-4: Stats strip
**EARS:** (Batch F2 replaces this strip: the page opens with three headline numbers from `stats.json`, and the rest move into a collapsed "How we counted" block that keeps today's wording.) Until F2 lands, the page shall show repos, commits, tombstones, revivals found in history, revivals via Revert and median gap, computed by `web:data` from the CLI's own stats.

- Cross-check: `research/matching-eval.md` measured 19,908 commits and 7,094 tombstones on the same six repos. The commit total must match. The tombstone total follows the miner as it is today (6,301 on this run); the data script prints both and the strip says "measured by the CLI at build time". The difference is not explained here and is not hidden.
- Median gap is shown in days, over all revival gaps, or "n/a".

### REQ-5: Accessibility
- `prefers-reduced-motion: reduce` disables shake, float and fog drift; ghosts appear by static fade (or not animated).
- Text and UI contrast is WCAG AA (4.5:1 body text, 3:1 large text and UI edges). A test computes the ratios of the palette.
- Every visual state has text: cracked = "Revert", hit = level + %, fog = count.

### REQ-6: Build and deploy
- `web/` has its own `vite.config.ts` and `tsconfig.json`; root `npm test` and `tsc` stay green and the CLI build is untouched.
- `.github/workflows/pages.yml` builds `web/` with base `/deja-boo/` and deploys to GitHub Pages.
- `npx vite build web && npx vite preview web` serves a working app (relative data URLs honor the base).

### REQ-7: Evidence first
- Never invent a cause. Nothing is called a revenant unless `findRevenants` says so.
- Palette: navy `#0b1020`, moss `#3d5a40`, bone `#e8e2d0`, ectoplasm `#7CFFB2` (matches only), blood `#c0392b` (blocks only).

## Judge-review batches (E to H)

Source: reviewer's side-by-side at 1440x900 with five other entries, and a first-time CLI run on pallets/click. The tool is solid; the first ten seconds are not. Evidence: the page opens with seven stat boxes whose labels need definitions, the story's stone (requests, 2020-02-18 Revert, a36a5b61502a63ed9b4b2b875e7420e118a72156) is off screen, the demo uses the one-stone fixture while the real requests graveyard blocks the code Kiro wrote in our real-history test (82% with two identifiers renamed), the page has no link to the video, repository or Devpost and no og:image, and it can only check the sample graveyards.

### REQ-8: Judge path (Batch E)
- **E1.** When the visitor presses the demo button, the page shall paste the real requests code (`docs/kiro-runs/rehearsal_requests2023_guarded.diff`, without the acknowledgement comment), select `requests` and summon, raising a36a5b61502a63ed9b4b2b875e7420e118a72156 at block with the obituary line. haunted-http stays as the last chip, labelled as a fixture; its data file name is unchanged.
- **E2.** The header shall link Demo video (https://youtu.be/E0bHgE6uA8I), Repository (https://github.com/rose050505/deja-boo) and Devpost (https://devpost.com/software/deja-boo), each in a new tab with `rel="noopener noreferrer"`. The page shall carry Open Graph and Twitter card meta (`og:title`, `og:description`, `og:image` absolute at https://rose050505.github.io/deja-boo/og.jpg, `og:url`, `twitter:card` = `summary_large_image`).

### REQ-9: First screen (Batch F)
- **F1.** The page shall open with a hero above the fold at 1440x900 and 375 px: one large sentence, one subline, one primary button (the E1 demo) and the video link. Proposed copy: "Your AI agent just rewrote code that was reverted in 2020." / "Déjà Boo stops it, and shows why the code died."
- **F2.** The page shall show three headline numbers from `stats.json`: commits walked; comebacks found and how many a reviewer confirmed real by hand (26 and 20, README "Why it matters"); comebacks via Revert, all real. The remaining numbers and their definitions move into a collapsed "How we counted" block with today's wording. Every number on the page comes from `stats.json` or is quoted from the README with a link to its evidence file (`research/labels/`, `research/matching-eval.md`).
- **F3.** The requests graveyard shall open scrolled to the 2020 Revert stone, with a short visible label next to it.
- **F4.** A three-step "For judges" strip: watch the video, press the demo button, run `index` and `check` on your own repo (Node 24+).
- **F5.** Hovering or focusing a stone shall show its epitaph next to the stone, not only in the caption under the grid.

### REQ-10: The moment it blocks (Batch G)
- **G1.** When a summon hits, the page shall scroll to the stone, shake it, raise a large ghost (3 to 4 times today's glyph, opacity still = similarity), briefly tint the page edge blood red and stamp "BLOCKED: the Kiro hook would stop this write" (warn: "WARN" in the normal palette, no red), then show the evidence card next to or right under the graveyard so stone and evidence share one screen.
- **G2.** Atmosphere in CSS/SVG only (no photos, no third-party art): night sky gradient with a moon, a ground strip, stone shading and texture, a slow faint fog that is always present and thickens with active hits. One display font for the title, an OFL font committed to the repo (no external font CDN). Reading surfaces (dialog, code, cards) stay plain and readable.
- **G3.** An opt-in sound toggle (default off) shall play one short synthesized sound when a ghost rises (Web Audio, generated in code, no audio files).

### REQ-11: Your own graveyard (Batch H)
- **H1.** When the visitor drops (or picks) a `.deja-boo/graveyard.json` written by `deja-boo index`, the page shall read it in the browser only, validate it, draw it as its own graveyard and make it the summon target. Nothing is uploaded. A malformed file gives a plain error and changes nothing. The largest sample (express, 1.3 MB) size must load without freezing.

### All batches (E to H)
- `prefers-reduced-motion` disables shake, float, fog drift and the tint animation (static states instead); every visual state keeps a text equivalent; contrast stays AA and the contrast test covers any new colour.
