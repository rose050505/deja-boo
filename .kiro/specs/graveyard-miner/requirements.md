# Graveyard Miner — Requirements

## Overview

The graveyard miner turns a git repository's history into a persistent graveyard of tombstones. Each tombstone records a block of code that was deliberately deleted, the commit that deleted it, and the cause of death. The miner is the "Bury" step of Déjà Boo's core loop.

---

## Functional Requirements

### REQ-1: Git log ingestion

**EARS:** When the miner is invoked on a repository path, the system shall spawn `git log -p --no-merges --no-color` with a machine-readable `--format` and parse every commit and its diff hunks from the output stream.

**Details:**
- Format string: `--format="=COMMIT %H %ae %s%n%b"` (hash, author email, subject, body), delimited so the parser can split commits reliably.
- Must handle repositories with no commits or a single commit without error.
- Respects an optional `--since` / `--until` date range to limit the walk.

---

### REQ-2: File filtering

**EARS:** While the system is parsing diff hunks, it shall skip any hunk whose file path matches a binary, lockfile, generated, minified, or vendored pattern.

**Default skip list (configurable):**
- Binary extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.pdf`, `.zip`, `.tar`, `.gz`, `.bin`, `.exe`, `.dll`, `.so`, `.dylib`.
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`, `composer.lock`.
- Generated/minified: any file whose name contains `.min.`, any file ending in `.map`, files in `dist/`, `build/`, `out/`, `__pycache__/`, `.next/`, `.nuxt/`.
- Vendored: `vendor/`, `node_modules/`, `third_party/`, `extern/`, `Pods/`.

**EARS:** When a file path matches the skip list, the system shall not emit any tombstone for hunks in that file.

---

### REQ-3: Deleted block extraction

**EARS:** When a hunk contains a run of four or more consecutive removed lines (lines starting with `-`) that are not all blank after stripping the `-` prefix, the system shall treat that run as a candidate deleted block.

**Details:**
- Minimum run length is configurable (`--min-block-lines`, default 4).
- Blank removed lines (empty or whitespace-only after stripping the `-` prefix) are skipped: they are neither counted toward the run length nor included in the block's content, and they do not end the current run.
- A run ends only when a context line (space-prefixed) or an added line (`+`-prefixed) is encountered.
- One hunk may yield multiple non-overlapping candidate blocks.
- Context lines (`space`-prefixed) and added lines (`+`-prefixed) are not included in a deleted block.

---

### REQ-4: Move detection (exclusion of moved blocks)

**EARS:** When a candidate deleted block's normalized content is sufficiently similar to added content anywhere in the same commit's diff (across all files), the system shall not create a tombstone for that block.

**Details:**
- Similarity is measured as Jaccard similarity between the fingerprint of the deleted block and the fingerprint of the union of all added lines in that commit (across all files and hunks).
- The similarity threshold is configurable via `--move-threshold` (default `0.9`). A deleted block with Jaccard similarity ≥ `--move-threshold` against the commit's union of added content is considered moved, not dead.
- This threshold deliberately accepts re-indented or lightly edited moves (e.g., reformatted parameters, changed indentation) as long as the content overlap is high.
- An "added block" for the union uses the same normalization as fingerprinting (REQ-5).
- Exact matches are always excluded (Jaccard = 1.0).

**Grace period:**
- If a later commit within `--grace-days` calendar days (default 7) re-adds a block whose fingerprint similarity to the tombstone is ≥ `--move-threshold`, the block was part of a split refactor and was not truly deleted: the tombstone shall be dropped from the graveyard.
- The grace period is measured from the date of the deleting commit to the date of the re-adding commit.
- If `--grace-days 0` is specified, the grace period is disabled.

---

### REQ-5: Normalization

**EARS:** When the system prepares a code block for fingerprinting, it shall normalize the text by stripping leading/trailing whitespace from each line, collapsing internal runs of whitespace to a single space, and removing single-line (`//`, `#`, `--`) and block (`/* */`, `<!-- -->`, `{- -}`) comments.

**Additional normalization (configurable):**
- **Identifier renaming** (`--rename-ids`, off by default): replace identifier tokens (word characters not matching language keywords) with the placeholder `_ID_`, so that trivially renamed copies are caught.
- Normalization is applied before both fingerprinting and move detection.
- Normalization must be idempotent: `normalize(normalize(x)) === normalize(x)`.

---

### REQ-6: Fingerprinting

**EARS:** When the system fingerprints a normalized code block, it shall use k-gram winnowing (MOSS-style) to produce a set of integer hashes that represent the block.

**Details:**
- k (shingle size in tokens) defaults to 7; configurable via `--kgram-size`.
- Window size (for winnowing) defaults to 4; configurable via `--window-size`.
- Tokens are the whitespace-split words of the normalized text.
- Each k-gram is hashed with a 32-bit FNV-1a hash.
- Winnowing selects the minimum hash in each sliding window; duplicates are removed to yield the final fingerprint set.
- A block with fewer than k tokens yields an empty fingerprint set and is discarded (not added to the graveyard).
- Fingerprinting must be deterministic: the same normalized text always produces the same fingerprint set.

---

### REQ-7: Tombstone construction

**EARS:** When a deleted block survives move detection and produces a non-empty fingerprint, the system shall create a Tombstone record with the following fields.

| Field | Source |
|---|---|
| `id` | SHA-1 of `${commit}:${path}:${hunkStart}` (hex string) |
| `fingerprint` | winnowed hash set (sorted ascending) |
| `lines` | raw deleted lines (without the leading `-`) |
| `path` | file path relative to repo root |
| `language` | inferred from file extension (see REQ-8) |
| `buriedAt` | ISO 8601 date from `git log` author date |
| `commit` | full 40-char commit hash |
| `author` | author email from `git log` |
| `causeOfDeath` | commit subject + body, trimmed; `"cause of death unknown"` if the message is empty or whitespace-only |
| `links` | PR/issue refs parsed from the commit message (see REQ-9) |

The `id` is deterministic: the same commit, path, and hunk start always produce the same id.

---

### REQ-8: Language detection

**EARS:** When building a tombstone, the system shall infer the programming language from the file extension using a static lookup table.

**Minimum table** (extensible):

| Extension | Language |
|---|---|
| `.ts`, `.tsx` | `typescript` |
| `.js`, `.mjs`, `.cjs` | `javascript` |
| `.py` | `python` |
| `.rb` | `ruby` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.java` | `java` |
| `.kt` | `kotlin` |
| `.cs` | `csharp` |
| `.cpp`, `.cc`, `.cxx` | `cpp` |
| `.c`, `.h` | `c` |
| `.swift` | `swift` |
| `.php` | `php` |
| `.sh`, `.bash` | `shell` |
| `.md` | `markdown` |
| (unknown) | `unknown` |

---

### REQ-9: Link extraction

**EARS:** When building a tombstone, the system shall scan the commit subject and body for issue and PR references and populate the `links` array.

**Patterns recognized:**
- Bare issue/PR refs: `#123` → `{"type":"issue","ref":"123"}`
- GitHub close keywords + ref: `closes #123`, `fixes #456`, `resolves #789` (case-insensitive)
- Full GitHub URLs: `https://github.com/<owner>/<repo>/issues/<n>` or `.../pull/<n>`

Each link object: `{ type: "issue" | "pr", ref: string, url?: string }`. Duplicates are removed. Order is stable (order of first appearance).

---

### REQ-10: Graveyard serialization

**EARS:** When the CLI `deja-boo index` completes, the system shall write a single JSON file at the path specified by `--out` (default `.deja-boo/graveyard.json`) containing a `Graveyard` object with two top-level keys: `tombstones` (array of Tombstone objects) and `stats` (a `GraveyardStats` object).

**Determinism rules:**
- Tombstones are sorted by `buriedAt` ascending, then `id` ascending as a tiebreaker.
- Each Tombstone's `fingerprint` array is sorted ascending.
- Each Tombstone's `links` array preserves first-appearance order.
- Each Tombstone's `revivals` and `deaths` arrays are sorted by `date` ascending.
- JSON keys within every nested object are sorted alphabetically.
- Output is pretty-printed with 2-space indentation.

**EARS:** When a tombstone with a duplicate `id` would be inserted (e.g., from a re-index), the system shall keep the existing record and discard the duplicate.

---

### REQ-11: CLI interface

**EARS:** When the user runs `deja-boo index [repo] --out <path>`, the system shall mine the repository at `[repo]` (defaulting to the current directory), write the graveyard JSON, and print a summary to stdout.

**Summary format (stdout):**
```
⚰️  Graveyard miner complete
   Commits walked  : 1234
   Hunks parsed    : 5678
   Blocks found    : 42
   Moves excluded  : 7
   Tombstones added: 35
   Written to      : .deja-boo/graveyard.json
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--out <path>` | `.deja-boo/graveyard.json` | Output file |
| `--min-block-lines <n>` | `4` | Minimum deleted-line run |
| `--kgram-size <k>` | `7` | k-gram width |
| `--window-size <w>` | `4` | Winnowing window |
| `--rename-ids` | off | Enable identifier renaming |
| `--move-threshold <n>` | `0.9` | Jaccard threshold for move detection and grace/revival matching |
| `--grace-days <n>` | `7` | Days after deletion within which a re-add drops the tombstone |
| `--since <date>` | (none) | Limit to commits after date |
| `--until <date>` | (none) | Limit to commits before date |
| `--verbose` | off | Print per-tombstone progress |

**EARS:** When `--out` specifies a path whose parent directory does not exist, the system shall create the directory before writing.

---

### REQ-12: Performance

**EARS:** When the miner indexes a repository with up to 5,000 commits, the system shall complete within 60 seconds on a standard developer laptop (single core, spinning commits sequentially).

**Approach:** Stream `git log -p` output line-by-line; do not buffer the entire output in memory. Process each commit as its lines arrive and discard raw lines after extracting blocks.

---

### REQ-13: Module boundary

**EARS:** When any file in `src/core/` is imported, it shall not transitively import any Node.js built-in module (`fs`, `path`, `child_process`, `os`, `stream`, etc.).

**Rationale:** `src/core` must remain browser-safe so the web UI can reuse normalize, fingerprint, and match without a bundler shim. All Node I/O lives in `src/miner/`.

---

### REQ-14: Historical revivals

**EARS:** When a block that already has a tombstone is re-added in a commit that falls outside the grace period (REQ-4), the system shall keep the tombstone and append a revival record to `tombstone.revivals[]`.

**Revival record fields:**

| Field | Source |
|---|---|
| `commit` | 40-char hash of the re-adding commit |
| `date` | ISO 8601 author date of the re-adding commit |
| `author` | author email of the re-adding commit |
| `subject` | commit subject line |
| `similarity` | Jaccard similarity between the revived block's fingerprint and the tombstone's fingerprint |

**Re-death:**
- If a revived block is subsequently deleted again (outside the grace period of its revival), the system shall append a new death record to `tombstone.deaths[]`.
- A death record has the same fields as a Tombstone except `id`, `revivals`, and `deaths` itself: `{ commit, date, author, causeOfDeath, links, fingerprint, lines, similarity }`.
- The initial deletion that created the tombstone is implicitly `deaths[0]`; subsequent re-deaths are appended in chronological order.

**Revert detection:**
- A revival whose commit subject starts with `"Revert"` (case-sensitive) is flagged as `isRevert: true` in the revival record.

**Graveyard summary:**
- The graveyard JSON shall include a top-level `stats` object alongside the tombstone array:

```json
{
  "tombstones": [...],
  "stats": {
    "commits": 1234,
    "tombstones": 35,
    "revivals": 4,
    "revivalsViaRevert": 1,
    "medianRevivalGapDays": 12
  }
}
```

- `medianRevivalGapDays` is the median of `(revival.date − death.date)` in whole days, taken over all revival records across all tombstones. If there are no revivals, the value is `null`.
- `revivalsViaRevert` counts revivals where `isRevert: true`.

**Updated `Tombstone` type:**

```typescript
export interface RevivalRecord {
  commit: string;
  date: string;        // ISO 8601
  author: string;
  subject: string;
  similarity: number;
  isRevert: boolean;
}

export interface DeathRecord {
  commit: string;
  date: string;        // ISO 8601
  author: string;
  causeOfDeath: string;
  links: Link[];
  fingerprint: number[];
  lines: string[];
  similarity: number;
}

export interface Tombstone {
  // ... existing fields ...
  revivals: RevivalRecord[];   // empty array if never revived; ordered chronologically
  deaths: DeathRecord[];       // subsequent re-deaths after the first (re-death[0] = second deletion, etc.)
}
```

**Determinism:**
- `revivals` and `deaths` arrays are ordered by date ascending.
- All `fingerprint` arrays within death records are sorted ascending.
- The `stats` block uses alphabetically sorted keys, consistent with REQ-10.

