# Revenant Watch: Design

## Module map

```
src/core/
  level.ts            # + optional `thresholds` param on hauntLevel (defaults unchanged)
  types.ts            # + Thresholds, WatchConfig, RevenantHit
  watch.ts            # NEW, pure: findRevenants, acknowledgedIds, addedLineNumbers  (browser-safe)

src/watch/            # NEW, Node edge shared by cli and mcp
  load.ts             # loadGraveyard(cwd), loadConfig(cwd): fs reads, validation
  format.ts           # formatHookMessage, formatCheckReport, causeText, linkText (pure strings)

src/cli/
  check-command.ts    # deja-boo check <file|->
  hook-command.ts     # deja-boo hook: stdin JSON -> decideHook -> exit code
  main.ts             # + dispatch for `check` and `hook`

src/mcp/
  tools.ts            # pure handlers: checkSnippet, getTombstone, listGraveyard
  server.ts           # stdio wiring with @modelcontextprotocol/sdk

.kiro/hooks/deja-boo-guard.json
.kiro/settings/mcp.json
.deja-boo/config.json # committed example with the default thresholds
```

`src/core` stays free of Node imports (`tech.md`). All `fs`, `process`, and stdin access lives in `src/watch`, `src/cli`, and `src/mcp`.

## Data flow

```
PreToolUse event (stdin JSON)
   │
   ▼
hook-command.ts ── parse + validate ──► tool_name? ──(other)──► exit 0
   │ fs_write: read current file from disk (missing => empty)
   ▼
core/watch.ts
   after = text | disk.replace(oldStr, newStr)
   added = addedLineNumbers(disk, after)      empty -> exit 0
   │
   ▼
findRevenants(graveyard, afterLines, thresholds, added)
   for each tombstone:
     m = matchWindowed(t, afterLines)          (src/core/match.ts)
     level = hauntLevel(t, m.similarity, thresholds)   (src/core/level.ts)
     keep when level != 'none' and added lines >= half of m.matchedLines
   │
   ▼
acknowledgedIds(content) ──► drop acknowledged revenants
   │
   ├─ none left ──► exit 0, silent
   └─ some left ──► formatHookMessage ─► stderr, exit 2
```

`check` and MCP `check_snippet` use the same `findRevenants`, with the whole input as the candidate and `added` omitted (every line counts as added). This is the only place a revenant is decided, so the three surfaces cannot disagree.

## Key interfaces

```ts
// core/types.ts
export interface Thresholds { warn: number; block: number }

export interface RevenantHit {
  tombstone: Tombstone;
  level: 'warn' | 'block';
  similarity: number;
  containment: number;
  matchedLines: [number, number];   // 1-based, in the candidate
}

// core/level.ts
export function hauntLevel(
  t: Pick<Tombstone, 'aliveAtHead' | 'causeOfDeath' | 'links'>,
  similarity: number,
  thresholds: Thresholds = { warn: WARN_THRESHOLD, block: BLOCK_THRESHOLD },
): HauntLevel;

// core/watch.ts
/**
 * 1-based line numbers of `after` that a line diff against `before` marks as inserted or replaced; trimmed lines are compared.
 * Invariant: addedLineNumbers(x, x) is empty; inserting k non-blank lines that are not whitespace variants of existing lines marks exactly those k lines.
 */
export function addedLineNumbers(before: string, after: string): Set<number>;

/** All tombstones with level != 'none', sorted by similarity desc, id asc. With `added`, a hit needs at least half of its matched window in `added`. Invariant: raising a threshold never adds a hit. */
export function findRevenants(graveyard: Graveyard, candidate: string[], thresholds: Thresholds, added?: ReadonlySet<number>): RevenantHit[];

/** Ids named by `deja-boo: checked <40 hex>` in `content`. Invariant: includes every id appended in that form. */
export function acknowledgedIds(content: string): Set<string>;
```

`RevenantHit` extends the structure's `Revenant` (`tombstone, similarity, matchedLines`) with `level` and `containment`. The existing `Revenant` type stays as is.

### Hook decision

```ts
// cli/hook-command.ts
export interface HookResult { exitCode: 0 | 1 | 2; stderr: string }

/** Exit code is 0 iff no unacknowledged revenant exists in the new code (for a valid event). */
export function decideHook(
  rawEvent: string,
  deps: { readFile(path: string): string | undefined; graveyard: Graveyard | undefined; config: WatchConfig },
): HookResult;
```

`decideHook` is pure apart from the injected `readFile`, so property tests drive it with in-memory files and generated graveyards. `runHookCommand` reads stdin, builds `deps` from disk (`cwd` from the event), calls `decideHook`, writes stderr, and sets the exit code.

Relative `tool_input.path` values resolve against the event's `cwd`.

## Decisions and trade-offs

**Exit 2 for warn in the hook.** The facts say only exit 2 reaches the headless agent, so a "soft" warn cannot exist in the hook. The warn level is kept in the message text, and the acknowledgement comment is the way through. In `check`, warn is exit 1 as specified. This is the one place where "when unsure, warn instead of block" is bent by the platform. The acknowledgement rule keeps the cost of a false alarm at one extra write.

**Added lines by line diff, matching on the full text.** An agent usually rewrites a whole file, and checking all of it would flag code already on disk. The first design kept only lines whose trimmed text is absent from the disk file. That fails on the demo: the revenant shares `method=request.method,`, `url=request.path,` and similar lines with live code, so only 4 of its 10 lines survived and the windowed score collapsed. The rule now is: score tombstones over the full post-write text, then require at least half of the matched window to be added lines. Added lines come from a Myers line diff on trimmed lines, so a window that sits in genuinely new lines is reported even when its lines repeat elsewhere, and unchanged or whitespace-only lines are never "added". The old trimmed-set limit from `research/matching-eval.md` no longer applies. A `str_replace` is expanded to the post-write text first, so it uses the same path.

**Acknowledgement scans the whole written content.** If the file already carries `deja-boo: checked <id>` and the agent rewrites the file, the old acknowledgement still applies. It names one id, is visible in the code, and is easy to remove.

**Failure mode.** Missing graveyard or bad event: exit 1 (never blocks). A guard that blocks every write because setup is incomplete is worse than a quiet guard. `check` uses exit 3 for the same cases because a human sees stderr.

**Performance.** Cost is tombstones × windows × `fingerprintLines`. For 1,500 tombstones and a 300-line write this may exceed 200 ms, because `matchWindowed` re-fingerprints every window. Plan:

1. Task 6 measures it with a benchmark test (synthetic 1,500-tombstone graveyard, 300-line write). Matching now runs over the full text, so this is the common case.
2. If it exceeds the budget, add an exact prefilter in `findRevenants`: skip a tombstone when its fingerprint shares no hash with the set of all k-gram hashes of the post-write text. It must not change results, and a property test (prefilter on versus off gives equal hits on generated inputs, including comment lines) guards that.
3. Do not change `matchWindowed` semantics or thresholds.
4. There is no candidate cap. If the budget is still missed, report the measured latency in the task notes and continue.

## Error handling

| Situation | hook | check | MCP |
|---|---|---|---|
| Graveyard missing | exit 1, one line | exit 3 with how-to | tool error with how-to |
| Config missing | defaults | defaults | defaults |
| Config invalid | defaults, silent | defaults, stderr note | defaults |
| Event JSON invalid | exit 1 | n/a | n/a |
| Unknown `tool_name` | exit 0 | n/a | n/a |
| Path skipped | exit 0 | no revenants | level none |
| Unknown tombstone id | n/a | n/a | tool error |

## Testing strategy

- Property tests (REQ-8) in `src/core/watch.test.ts`, `src/core/level.test.ts`, and `src/cli/hook-command.test.ts`. Generators build small graveyards (tombstones with random fingerprints, causes, links, `aliveAtHead`) and candidates that embed tombstone lines.
- Unit tests: `addedLineNumbers` cases (insert, replace, whitespace-only, missing file), message format golden strings (with the line range), `cause of death unknown`, link formatting, config validation, `check` report, MCP handlers.
- Acceptance (REQ-9) in `src/cli/demo-hook.test.ts`, reusing the builder as `src/miner/haunted-http.test.ts` does. It needs `dist/` for the spawned run. A `beforeAll` runs `tsc --project tsconfig.build.json` only if `dist/cli/main.js` is older than its source, to keep `npm test` self-contained.
- Dogfood test (REQ-7) parses both `.kiro` files.
- Latency test (REQ-4) uses a seeded synthetic graveyard and asserts `decideHook` takes under 200 ms.
