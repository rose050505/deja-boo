---
inclusion: fileMatch
fileMatchPattern: ["web/**", "src/cli/**", "power/**"]
---

# Ghost voice and haunted design

The spooky theme must **carry the function**, not decorate it (Costume Contest rule).

## Visual mapping
- Graveyard = repository history. One **tombstone** per deleted block; size grows with lines buried.
- Epitaph on the stone = cause of death (first line of the commit message) + date.
- A **ghost rises** only when new code matches a tombstone. Ghost opacity = similarity.
- Fog thickens with how many revenants are active right now.
- Palette: night navy `#0b1020`, moss `#3d5a40`, bone `#e8e2d0`, ectoplasm green `#7CFFB2` (matches only), blood red `#c0392b` (blocks only).
- Respect `prefers-reduced-motion`: no floating animation, static fade instead.
- Accessible: every visual state also has text; contrast AA or better.

## Copy voice
- Short, dry, a little theatrical: "You buried this on Mar 2. It leaked memory. Let it rest."
- Facts first, joke second. Never let the joke hide the commit hash or reason.
- No third-party trademarks or copyrighted characters.
