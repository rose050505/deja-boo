Reviewer: batches E and F are in. Now implement `haunted-graveyard` batch G (the moment it blocks, atmosphere, sound), as written in the spec. Read `.kiro/specs/haunted-graveyard/` and `.kiro/steering/ghost-voice.md` first. This entry is in the Costume Contest category ("a polished, spooky UI that enhances the function"), so this batch carries a large part of the Design score. The theme must carry the function: every effect below marks a real state (a hit, its level, how many are active).

Why: on the live page today, a block shows as a small ghost glyph with "95%" next to one stone, and the evidence card appears about two screens further down, so the stone and the evidence never share a screen. Other entries turn the same moment into a scene (the page tints red, a stone rises out of the ground, STOP). The page itself is a flat navy background with flat green stones (`style.css` is ~110 lines, system fonts); the fog only appears after a hit.

G1. The moment it blocks (when a summon has hits):
- Bring the first haunted stone into view, shake it (short), flash its crack if it is a Revert.
- Raise a large ghost out of it: 3 to 4 times today's glyph, rising from the stone with a short ease, opacity = similarity (keep `ghostOpacity`), the percentage beside it in readable size. Other hits get the normal-size ghost.
- Block: briefly tint the viewport edges blood red (a vignette, about 1 s, then a faint steady edge while the result is shown) and stamp "BLOCKED" with the line "The Kiro hook would stop this write." over the graveyard for a moment. Warn: a "WARN" stamp in bone/ecto colours, no red. Blood red stays reserved for blocks (steering).
- Put the evidence card where the stone is: directly under the graveyard (or beside it on wide screens), so that at 1440x900 the haunted stone and the first lines of the evidence (level, %, epitaph, cause, obituary) are visible together. The full list of hits and the marked pasted code can follow below.
- Clearing or a new summon removes the stamp, tint and ghosts.

G2. Atmosphere, CSS/SVG only (no photos, no third-party art or icons):
- Night sky gradient behind the header and graveyard, a moon (soft glow), a few faint stars; a ground strip with a hint of grass along the bottom of each graveyard row or under the grid.
- Stones: stone-grey to moss shading (gradient), a subtle texture or edge highlight, and a darker base where they meet the ground. Cracked Revert stones keep their red edge and crack. Keep sizes and layout from `layout.ts`.
- Fog: a faint, slow-drifting layer always present, thickening with active hits (keep `fogDensity` and the fog text).
- One display font for the title (and optionally section headings): an OFL-licensed font file committed under `web/public/fonts/` with its licence file, loaded with `@font-face` and `font-display: swap`. No external font CDN. Body text stays a readable sans.
- Reading surfaces (dialog, code blocks, evidence cards, the summon textarea) stay plain and high contrast.

G3. Sound: a toggle in the header, "Sound: off" by default (state in `localStorage`). When on, one short synthesized sound when a ghost rises (a low swell plus a soft chime for block; softer for warn), made with Web Audio in code, no audio files, nothing plays before the user turns it on.

All of G: `prefers-reduced-motion: reduce` turns off shake, rise, drift and the tint animation; show the final states statically (ghost at full position, stamp shown without motion, steady edge). Every visual state keeps its text equivalent (stamp text is real text, not only an image; fog text stays). Contrast stays AA; extend the contrast test to any new colour used for text or UI edges. Performance: no layout thrash on the express graveyard (1,134 stones); prefer CSS transforms/opacity; nothing animates continuously except the fog and stars, and those must be cheap (no per-stone animation loops).

Keep all existing behaviour and tests (demo button, header links, hero, judges strip, tooltip, dialog, obituary rendering).

Done means: batch G tasks ticked in `tasks.md` with one-line notes, tests for what is testable (the stamp text for block and warn, the sound toggle default and persistence with Web Audio stubbed, reduced-motion class switches, contrast), `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run web:build` pass. Commit with a message ending in "(Kiro CLI)". Don't push. Report what you changed, the font you chose and its licence, and anything you left out.
