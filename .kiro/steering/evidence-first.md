---
inclusion: always
---

# Evidence first

Déjà Boo accuses code of being a revenant. A false accusation destroys trust, so:

- Every warning shows **evidence**: the commit hash, date, the deleted lines, and the cause of death taken verbatim from the commit message or linked PR. Never invent a cause.
- If there is no clear reason in history, say "cause of death unknown" instead of guessing.
- A block **moved** to another file in the same commit is not a death. Neither is whitespace-only or rename-only churn.
- Similarity thresholds are measured, not guessed: change them only with numbers from `research/` (precision / recall on labeled cases).
- When unsure, warn instead of block.
