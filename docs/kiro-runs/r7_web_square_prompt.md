Reviewer: a design rule from the project owner, found again in the demo-video review. The owner has asked for this twice before on other projects.

Rule: corners are square by default. Only things that are actually round stay round. Here that means the tombstones and the ghost in the graveyard SVG. Panels, sections, stat boxes, chips, buttons, the textarea, code/cause blocks, the ghost card, the badge and the dialog all get `border-radius: 0`. Also avoid wrapping every block in the same identical box. Where two neighbouring blocks have the same role, separate them with a rule line, spacing or a thick left border instead of another rounded card. Keep it modest: this is a polish pass, not a redesign. Colours, fonts, layout and sizes stay as they are.

Do:
1. In web/src/style.css, set every border-radius to 0 except for the stone and ghost shapes, which are SVG paths and unaffected. Add a short comment at the top of style.css: "Corners are square by design; only tombstones and ghosts are round."
2. Write the same rule in .kiro/steering/ghost-voice.md (one line under the visual rules), so future changes keep it.
3. If a layout or contrast test checks radii, update it. Otherwise add a tiny test that style.css has no non-zero border-radius.
4. `npm test`, `npx tsc --noEmit` and `npm run web:build` pass. Commit with a message ending in "(Kiro CLI)". Don't push.
