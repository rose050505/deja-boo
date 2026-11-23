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
- The button "Try the haunted chunked upload" loads the demo snippet, selects `haunted-http` and summons.
- Fog density grows with the number of active hits (text count shown too).

### REQ-4: Stats strip
**EARS:** The page shall show repos, commits, tombstones, revivals found in history, revivals via Revert and median gap, computed by `web:data` from the CLI's own stats.

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
