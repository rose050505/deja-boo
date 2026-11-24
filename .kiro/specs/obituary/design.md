# Obituary: Design

## Module map

```
src/core/
  revert.ts           # NEW, pure: isRevertSubject (the only revert regex in the repo)
  obituary.ts         # NEW, pure: makeExcerpt, entryFromGitHub, hasObituaryText, obituaryLine, pickPullRequest
  level.ts            # isRevertCause delegates to isRevertSubject; hauntLevel evidence adds obituary text
  types.ts            # + Obituary types, Link.type 'ref', Tombstone.obituary?, Graveyard.repoUrl?

src/obituary/         # NEW, Node edge (the only network and process code for this feature)
  remote.ts           # parseGitHubRemote(url) pure; originRepo(cwd) spawns `git remote get-url origin`
  github.ts           # createGitHubFetcher(token): fetch wrapper -> FetchOutcome; resolveToken(env, runGh)
  select.ts           # pure: selectCommits(graveyard, limit, have) -> sha + tombstone links in priority order
  run.ts              # pure orchestration: runObituary({ graveyard, repo, limit, existing, fetcher, now }) -> { file, summary }

src/miner/
  link-parser.ts      # parseLinks(message, repoUrl?) with kind 'ref' and dedupe by ref
  revival-tracker.ts  # isRevert uses isRevertSubject
  index.ts            # reads origin once, sets graveyard.repoUrl, passes it to buildTombstone

src/watch/
  load.ts             # + loadObituaries(dir): attaches Tombstone.obituary in memory; notes[] on invalid files
  format.ts           # + obituary line in hook entry, Stop text, check report; linkText knows 'ref'

src/cli/
  obituary-command.ts # deja-boo obituary: argv, token, fetcher, write file, summary, exit codes
  main.ts             # + dispatch and --help
  stop-command.ts     # adds the obituary line through format.ts

src/mcp/tools.ts      # get_tombstone: obituary; check_snippet: obituary line fields; list_graveyard: hasObituary
web/scripts/          # build-data.ts reads <clone>/.deja-boo/obituaries.json; strip.ts keeps `obituary`
web/src/              # dialog section and ghost-card line
research/obituary-eval.md, research/scripts/obituary-eval.mjs
```

`src/core` stays free of Node imports and network. Obituary text reaches core code only as plain data on the tombstone.

## Data flow

```
deja-boo index ──► graveyard.json (+ repoUrl, links with url and kind)          (offline, unchanged otherwise)

deja-boo obituary                                                               (opt-in, only networked step)
   graveyard.json ──► selectCommits ──► for each sha (<= limit, skipping existing entries):
                          fetcher(commits/{sha}/pulls) ─► pickPullRequest ─► pr
                          fetcher(issues/{n}) for linked numbers (<= 3, memoized)
                          entryFromGitHub (makeExcerpt) ─► entry
                       rate-limited? ─► stop, keep entries so far
   entries ──► .deja-boo/obituaries.json (sorted keys)

check / hook / stop / MCP / web:data
   loadGraveyard ──► loadObituaries (optional) ──► tombstone.obituary (in memory)
        hauntLevel(t, sim)  reads t.obituary only to decide "has a reason"
        format*(…)          prints the obituary line when hasObituaryText(t.obituary)
```

## Key interfaces

```ts
// core/types.ts
export interface ObituaryRef { number: number; url: string; title: string; excerpt: string; truncated: boolean }
export interface Obituary { pr: ObituaryRef | null; issues: ObituaryRef[]; fetchedAt: string }
export type ObituaryFile = Record<string, Obituary>;       // key: 40-char death commit sha
export interface Link { type: 'issue' | 'pr' | 'ref'; ref: string; url?: string }
// Tombstone gains: obituary?: Obituary   (in memory / web JSON only; never in graveyard.json)
// Graveyard gains: repoUrl?: string

// core/revert.ts
/** True when the first line of `text` starts with revert, reverts, reverted or reverting (case-insensitive) as a whole word. Invariant: the only revert test in the repo. */
export function isRevertSubject(text: string): boolean;   // /^\s*revert(?:s|ed|ing)?\b/i on text.split('\n')[0]

// core/obituary.ts
/** Collapse whitespace and take the first 400 code units without splitting a surrogate pair. Invariant: result is a prefix of the collapsed body, length <= 400. */
export function makeExcerpt(body: string | null | undefined): { excerpt: string; truncated: boolean };
export function hasObituaryText(o: Obituary | undefined): boolean;  // pr or any issue with excerpt !== ''
/** One line: Obituary (PR #5353): "…" <url>. Returns '' when there is no text. Invariant: length <= max. */
export function obituaryLine(o: Obituary, max: number): string;

// obituary/github.ts
export type FetchOutcome =
  | { kind: 'ok'; json: unknown }
  | { kind: 'rate-limited'; resetAt?: string }
  | { kind: 'error'; status?: number; message: string };
export type GitHubFetcher = (path: string) => Promise<FetchOutcome>;   // path like /repos/o/r/issues/12
```

`hauntLevel` evidence becomes:

```ts
const hasReason = isRevertSubject(t.causeOfDeath) || t.links.length > 0 || hasObituaryText(t.obituary);
```

and `isRevertCause = isRevertSubject`. The alive filter, the evidence test, `revival-tracker`, `stats`, and the web "cracked" stone all go through that one function.

## Decisions and trade-offs

**Obituary is a separate file, attached in memory.** Alternatives: write it into `graveyard.json` (changes the deterministic output and forces a re-index to refresh), or into `causeOfDeath` (breaks `evidence-first`: the cause must be verbatim from the commit). A sidecar file keeps `index` offline and reproducible, lets the obituary be refreshed alone, and makes "no file means no change" a simple absence check. The cost is one more file to load; `load.ts` hides it.

**Links still count as a reason without an obituary.** The review says "has a reason" is a Revert or an obituary/linked issue with non-empty text. Reading that as "a bare `#N` no longer counts" would lower levels on every existing graveyard and break the unchanged-output rule. So the rule is additive: Revert, link, or obituary text. Open question for the reviewer below.

**Selection by commit, not by tombstone.** Many tombstones share one death commit; the API answers per commit. `--limit` counts commits, which is what the rate limit counts.

**Empty entries are stored.** A commit with no PR is stored as `pr: null, issues: []`. Without it every re-run would spend a request on the same direct pushes. Errors are not stored, so they are retried.

**`/issues/{n}` for PR numbers.** One endpoint covers both, and its `html_url` is the right one for either kind. The reviewer's `repoUrl/issues/N` link relies on GitHub's redirect for the same reason.

**Rate limit is a clean stop, exit 0.** The run did what it could, the file is valid, and a re-run continues. A non-zero code would make scripts treat partial progress as failure. The stderr note says how far it got and when the limit resets.

**`truncated` field.** The excerpt must stay verbatim, so `…` cannot be stored in it. A boolean lets every display add the ellipsis outside the quotes without guessing from length 400.

**Revert predicate widened.** `/^revert/i` also matches `Revertible`, `/^revert\b/i` misses `Reverting`, and `startsWith('Revert')` misses lowercase. `^revert(s|ed|ing)?\b` is the narrowest rule that covers the reviewer's "reverting 3362" case. It is measured in `research/obituary-eval.md` before it ships, because it moves levels on existing graveyards.

**Hook size.** The obituary line is the cheapest thing to cut: 500 characters at most, its excerpt shortens first. The cause is verbatim history of the tombstone and keeps its room.

**Privacy and safety.** The token is read from the environment or `gh`, passed in an `Authorization` header only to `api.github.com`, and not logged. Excerpts are public PR/issue text stored verbatim as data. They reach agents inside hook and MCP output, so they are untrusted content that may contain instructions. Formatters print them inside quotes after a fixed label, and the Kiro skill text tells the agent to treat them as data (see tasks).

## Error handling

| Situation | `obituary` | other commands |
|---|---|---|
| No GitHub repo found | exit 1, one line | n/a |
| Graveyard missing | exit 3 with how-to | unchanged |
| Rate limited | stop, write partial, exit 0, stderr note | n/a |
| 404 / 5xx / network error | skip commit, count failed, continue | n/a |
| Response of unexpected shape | same as error | n/a |
| Obituary file missing | n/a | no change at all |
| Obituary file invalid JSON or shape | n/a | ignored; `check` notes it on stderr; hook silent |
| Entry missing for a commit, file present | n/a | `check` and `get_tombstone`: `obituary: not fetched` |
| Entry empty, file present | n/a | `check` and `get_tombstone`: `obituary: none found on GitHub (looked up <date>)` |

## Testing strategy

- Property tests as listed in REQ-8, in `src/core/obituary.test.ts`, `src/core/revert.test.ts`, `src/core/level.test.ts`, `src/obituary/run.test.ts`, `src/miner/link-parser.test.ts`, and `src/watch/watch.test.ts`.
- `run.ts` is tested with a scripted fetcher (a map of paths to outcomes, plus a call log). No test imports `github.ts` except one that stubs `globalThis.fetch` to check headers, the rate-limit detection, and that the token never appears in output.
- `parseGitHubRemote` is tested on the three URL forms plus non-GitHub hosts and junk.
- Golden strings: hook entry, Stop text, `check` report, MCP `get_tombstone`, with and without obituary, and the "file present, not covered" lines.
- Byte-for-byte test: run the existing golden tests with no obituary file and assert identical strings. A `haunted-http` fixture index with no origin has no `repoUrl` and an identical `graveyard.json`.
- Source-scan test: no revert regex or `startsWith('Revert')` outside `src/core/revert.ts`; `fetch(` only in `src/obituary/github.ts`.
- Demo acceptance (REQ-9): a recorded fetcher response for PR #5353 drives the hook on a fixture tombstone.
- Web: `web/src` tests for the dialog and ghost-card strings, and `strip.test.ts` for the size limit with obituaries.

## Open questions for the reviewer

1. Should a bare `#N` with no obituary still count as a reason for `block`? This design says yes (no change without a file). The stricter reading, "only text counts", would lower some levels on existing graveyards.
2. REQ-5 asks for "say nothing new" when there is no obituary and also "when the obituary is missing, say so". This design says nothing in the hook, Stop, `check_snippet`, and the web ghost card, and says so in `check` and `get_tombstone`, only when an obituary file exists. With no file, nothing changes. Agree?
3. `.deja-boo/obituaries.json` is git-ignored like the graveyard. It costs API requests to rebuild; committing it for this repo's own dogfooding would be possible.
4. `Link.type` gains `'ref'`. Anything outside this repo that reads graveyard JSON (the Power bundle, the web) must accept it. Both are in this repo and covered by tasks.
