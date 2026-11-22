---
inclusion: fileMatch
fileMatchPattern: ["**/*.test.ts", "src/core/**"]
---

# Testing rules

- Use **fast-check** property tests for every function in `src/core`. Required properties:
  - `normalize` is idempotent and ignores whitespace / comment-only differences.
  - `similarity(a, a) === 1` for any non-trivial snippet; `similarity` is symmetric and in [0, 1].
  - Raising the threshold never adds matches (monotonicity).
  - Code moved between files in one commit never produces a tombstone.
  - Fingerprints are deterministic across runs.
- Unit tests cover the git-log parser with small fixture repos created in a temp dir (`git init`, scripted commits).
- A failing property must print the shrunk counterexample; record notable ones in `research/pbt-findings.md`.
