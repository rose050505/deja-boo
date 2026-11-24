# Obituary: Requirements

## Overview

Most tombstones do not say why the code died. The cause of death is the commit subject plus body (`src/miner/build-tombstone.ts`), and many death commits have neither a body nor a link. The obituary is an opt-in enrichment that looks up, on GitHub, the pull request that contained the death commit and the issues the commit message mentions, and stores a verbatim excerpt of their text next to the tombstone. Everything is shown as a separate, labelled "Obituary" and never merged into `causeOfDeath`.

It builds on the finished `graveyard-miner`, `revenant-watch`, and `haunted-graveyard` specs. The offline core (`index`, `check`, `hook`, MCP) keeps working unchanged when no obituary file exists.

### Measured motivation

Counted from `web/public/graveyards/*.json` (share of tombstones whose death commit has no body and no link): express 76%, flask 80%, requests 68%, got 56%.

- Reverts: only 17 of 77 Revert tombstones across the 6 repos give a reason beyond "This reverts commit …" (express 0/14, requests 5/27).
- 1,595 links have no URL (axios 434, got 460), and every bare `#N` is classified as `issue` (`src/miner/link-parser.ts`), so an agent cannot follow them.
- Demo case: psf/requests tombstone `a36a5b6` was buried by `24bcb9e`, a bare revert. In every guarded take Kiro said "the revert gives no reason" and stopped to ask. The pull request that made the revert, psf/requests#5353 (found with `gh api repos/psf/requests/commits/24bcb9eab60d2db5e71979ea391b3e5675daff1f/pulls`), says: "A number of PRs were merged back in September without any proper review … I'm going to revert for now to get 2.23.0 out the door, and we can revisit them afterwards as needed." That is a release-management reason, and it tells the agent what to check.

Terms: the *death commit* of a tombstone is `tombstone.commit`. An *obituary entry* is the record stored for one death commit. An *obituary file* is `.deja-boo/obituaries.json`. A *fetcher* is the injected function that performs one GitHub API request.

## Requirements

### REQ-1: `deja-boo obituary`

**EARS:** When the user runs `deja-boo obituary [--repo owner/name] [--limit N] [--graveyard <file>] [--out <file>]`, the system shall read the graveyard, ask GitHub about a prioritized set of death commits, and write the obituary file.

- Defaults: graveyard `.deja-boo/graveyard.json`, output `.deja-boo/obituaries.json`, `--limit 300`. `--limit` must be an integer >= 1.
- **Repo.** `--repo` wins. Otherwise the repo comes from `git remote get-url origin` of the current directory, accepting `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, and `ssh://git@github.com/o/r(.git)`. Only `github.com` is supported.
- **EARS:** If no GitHub repo can be determined, the system shall exit 1 with a one-line reason and write nothing.
- **EARS:** If the graveyard file is missing or unreadable, the system shall print how to create it (`deja-boo index . --out .deja-boo/graveyard.json`) on stderr and exit 3, as `check` does.
- **Selection and order.** Candidate tombstones are the watched ones (`aliveAtHead !== true` or a Revert, the `isWatched` rule of the web data step). Groups, in order: (1) Revert tombstones, (2) tombstones with at least one revival, (3) tombstones with at least one link. A tombstone belongs to its first matching group. Tombstones in none of the groups are not fetched. Inside a group, newest `buriedAtTimestamp` first, ties by id. Tombstones are reduced to distinct death commits in that order, and the first `--limit` commits are processed.
- **Requests per commit.**
  1. `GET /repos/{o}/{r}/commits/{sha}/pulls` (one call).
  2. For each distinct issue or PR number referenced by the commit's links (`tombstone.links`, any kind, same repo only, first 3 in message order) that is not the number of the chosen PR, `GET /repos/{o}/{r}/issues/{n}`. The issue endpoint also answers for pull request numbers. A number already fetched in this run is reused, not fetched again.
- **PR choice.** When the commit belongs to several pull requests, choose the merged one whose `merge_commit_sha` equals the death commit, else the merged one with the lowest number, else the open or closed one with the lowest number. The choice is deterministic.
- **Auth.** `GITHUB_TOKEN` if set and non-empty; else the output of `gh auth token` if `gh` is installed and succeeds; else unauthenticated. The token is sent only to `https://api.github.com`, and is never printed, logged, or written to a file.
- **EARS:** If GitHub answers with a rate limit (HTTP 403 or 429 with `x-ratelimit-remaining: 0` or a `retry-after` header), the system shall stop sending requests, write every entry gathered so far, say on stderr how many of how many commits were done and when the limit resets, and exit 0.
- **EARS:** If a request fails for any other reason (network error, 404, 5xx), the system shall skip that commit without writing an entry for it, count it as failed, and continue. A failed commit is retried on the next run.
- **Re-runs.** An entry already in the output file is kept as is and its commit is not fetched again, and it does not count toward `--limit`. Only commits without an entry are fetched.
- **Summary.** The command prints, on stdout, the number of commits looked up, entries with a PR, entries with issues, entries with neither, failed, and not reached because of `--limit` or a rate limit.
- A commit that was looked up and has no PR and no issue gets an entry with `pr: null` and `issues: []` (so it is not asked again). It is never shown as a reason.
- The command is the only code in the repository that makes network calls. `src/core`, `src/miner`, `check`, `hook`, and MCP make none.

### REQ-2: Obituary file and excerpts

**EARS:** The system shall write `.deja-boo/obituaries.json` as a JSON object keyed by the 40-character death commit sha, with sorted keys and entries of this shape:

```
{ "pr": { "number": 5353, "url": "https://github.com/psf/requests/pull/5353", "title": "...", "excerpt": "...", "truncated": false } | null,
  "issues": [ { "number": 1, "url": "...", "title": "...", "excerpt": "...", "truncated": false } ],
  "fetchedAt": "2026-01-02T03:04:05.000Z" }
```

- `excerpt` is the first 400 UTF-16 code units of the body after whitespace collapse (every run of whitespace becomes one space, then trim), cut so that it never splits a surrogate pair. It is never paraphrased, summarized, generated, or decorated (no `…` inside the stored text). A null or empty body gives `""`.
- `truncated` is true when the collapsed body was longer than the excerpt. It is the only addition to the review's shape. It lets displays add `…` outside the quoted text without guessing.
- `title` is the title as returned. `url` is the `html_url` returned by GitHub.
- `issues` keeps the order of the commit's links. Duplicates of `pr.number` are omitted.
- Entries are sorted by sha in the file. A re-run keeps existing `fetchedAt` values. The only non-deterministic field is `fetchedAt` of new entries (the clock is injected in tests).
- The file lives next to the graveyard. It is listed in `.gitignore` like `graveyard.json`, and rebuilt by running the command again.

### REQ-3: Injected fetcher

**EARS:** The obituary logic shall take its GitHub access as a parameter, so tests never touch the network.

- Interface: `GitHubFetcher = (path: string) => Promise<FetchOutcome>`, where `FetchOutcome` is `{ kind: 'ok'; json: unknown } | { kind: 'rate-limited'; resetAt?: string } | { kind: 'error'; status?: number; message: string }`. The real fetcher (Node `fetch`, headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version`, `User-Agent: deja-boo`) lives in its own module under `src/obituary/` and is the only file that calls `fetch`.
- The number of fetcher calls in one run is at most `limit` (one commits/pulls call per commit) plus the linked-issue lookups (at most 3 per commit, never repeated for the same number).
- Responses are validated at the boundary: a body that is not the expected shape counts as an error for that commit, never as an entry with invented fields.

### REQ-4: Remote and links at index time

**EARS:** When `deja-boo index` runs in a repo whose `origin` is a GitHub remote, the system shall record `repoUrl` in `graveyard.json` and give every bare reference a URL.

- `graveyard.json` gains an optional top-level `repoUrl` in the form `https://github.com/<o>/<r>` (no `.git`, no trailing slash). It is absent when there is no origin or the origin is not GitHub. A missing `repoUrl` leaves the output as before.
- A bare `#N` (and a close-keyword reference) gets `url = <repoUrl>/issues/N` when `repoUrl` is known. GitHub redirects an issue URL to the pull request when `N` is a PR. Links that already carry a URL keep it.
- **Link kind stays honest.** `Link.type` becomes `'issue' | 'pr' | 'ref'`. A bare `#N` is `'ref'` (unknown). A `closes/fixes/resolves #N` reference is `'issue'`. A full `/issues/N` URL is `'issue'`, a full `/pull/N` URL is `'pr'`. Text output prints `ref #N` for `'ref'`.
- Links are deduplicated by `ref` across kinds, keeping the most specific kind (URL kinds, then close-keyword `issue`, then `ref`), so `PR #5 … #5` yields one link.
- Existing graveyards with bare links typed `issue` still load. Nothing re-types them until `index` runs again.

### REQ-5: Where the obituary is shown

**EARS:** Where an obituary entry has a PR or issue with a non-empty excerpt, every surface that shows a tombstone shall show it under the cause of death, labelled and with its URL.

| Surface | What is shown |
|---|---|
| Hook message and Stop message | One extra line per entry: `Obituary (PR #5353): "<excerpt>" <url>`. A truncated excerpt ends with `…` before the closing quote. With no PR, the first linked issue is used: `Obituary (issue #12): ...`. |
| MCP `get_tombstone` | The full record under `obituary`: `pr`, `issues`, `fetchedAt` (titles included). |
| MCP `check_snippet`, `list_graveyard` | `obituary` (the same one-line fields: kind, number, url, excerpt) in `check_snippet` revenants. `list_graveyard` adds only `hasObituary: boolean`. |
| `deja-boo check` | An `obituary:` block under `cause:` with kind, number, url, title, and the excerpt. |
| Web tombstone dialog | A section "Obituary (from GitHub PR #n, fetched <date>)" under the cause of death, with a link to the PR or issue, title, and excerpt. |
| Web ghost card | The same one-line form as the hook, under the cause. |

- The obituary never replaces, edits, or is concatenated into `causeOfDeath`. The cause stays verbatim from the commit.
- Entries with `pr: null`, no issues, or only empty excerpts show no obituary line (a title alone is not a reason).
- **No obituary file:** every output is unchanged, character for character (REQ-8).
- **Obituary file present, tombstone not covered:** `check` and `get_tombstone` state the fact in one line: `obituary: not fetched` when the death commit has no entry, and `obituary: none found on GitHub (looked up <date>)` when the entry is empty. The hook, the Stop message, `check_snippet`, `list_graveyard`, and the web ghost card say nothing, so they do not grow when there is nothing to add. Nothing is ever inferred.
- Obituaries are loaded by `src/watch/load.ts` next to the graveyard (same directory, or `<cwd>/.deja-boo/obituaries.json`) and attached to tombstones in memory as `obituary`. They are not written into `graveyard.json`. A missing file is not an error. An invalid file is ignored and reported on stderr by `check` (silent in the hook, as for config).
- Hook entries keep their 1,200-character cap. The obituary line is cut first (its excerpt shortens, with `…`), to at most 500 characters. The cause, id, commit, and line range keep the rules of revenant-watch REQ-5.

### REQ-6: Block evidence

**EARS:** When `hauntLevel` decides between `warn` and `block`, it shall treat a tombstone as having a reason when its cause of death is a Revert, or it has at least one link, or its obituary has a PR or issue with a non-empty excerpt.

- A link still counts without an obituary, as today (`links.length > 0`), so the level for a graveyard without an obituary file is unchanged. The obituary can only add a reason (for example a PR found through the commit with no `#N` in the message).
- `hauntLevel` takes the obituary through the tombstone (`Pick<Tombstone, 'aliveAtHead' | 'causeOfDeath' | 'links' | 'obituary'>`, `obituary` optional) and stays pure. Two-argument and three-argument calls keep working.
- Thresholds are not touched. The block rule is "when unsure, warn": the only new path to `block` is a reason with text.
- **One Revert predicate.** `isRevertSubject(text)` in `src/core/revert.ts` matches `^\s*revert(s|ed|ing)?\b` case-insensitively on the first line of `text`. So `Revert "x"`, `revert: x`, `Reverting 3362`, and `reverts the last commit` are Reverts, and `Revertible type` and `Preserve` are not. `isRevertCause` (alive filter, web cracked stones, stats) and `hauntLevel` evidence both call it, and so does `revival-tracker` (today `startsWith('Revert')`, case-sensitive). No other file contains a revert regex.
- This changes `isRevert` of existing revivals and some tombstone levels on existing graveyards. The change is deliberate and must be measured (REQ-9).

### REQ-7: Web data

**EARS:** When `npm run web:data` builds a repo's graveyard JSON and `<clone>/.deja-boo/obituaries.json` exists, the system shall embed the obituary entry in each tombstone of that repo's web file.

- `web:data` makes no network calls. The README step is: run `node dist/cli/main.js obituary` in each clone first.
- The web tombstone gains optional `obituary` with the REQ-2 entry shape (without `fetchedAt` per issue; one `fetchedAt` for the entry). Tombstones without usable text carry nothing.
- The 3 MB per-file limit still applies. Obituaries are 400 characters per PR or issue at most and are counted in the limit. If a file would exceed it, the existing trimming rule applies first to tombstones, and the obituary is never cut to fit.
- Where a repo has no obituary file, its web JSON is byte-for-byte what it was.
- Web matching (`web/src/summon.ts`) uses the same `hauntLevel`, so the web, the hook, and `check` agree.

### REQ-8: Property tests (fast-check)

1. **Excerpt:** for any body string, `excerpt` is a substring of the whitespace-collapsed body, is a prefix of it, has length <= 400, never ends in half a surrogate pair, and `truncated` is true iff the collapsed body is longer than the excerpt.
2. **No obituary file, no change:** loading without an obituary file, then formatting hook, Stop, `check`, MCP, and web outputs, gives strings equal to a run where the `obituary` code path is absent (golden strings from the current outputs). `hauntLevel` with no `obituary` equals the previous function for every input.
3. **Fetch budget:** for any graveyard and any `limit`, with a scripted fetcher, the number of calls is <= `limit` + 3 x (commits processed), calls to `/issues/{n}` never repeat a number, and a `rate-limited` outcome at call k yields exactly the entries gathered before call k, with no further calls.
4. **Partial results are valid:** the file written after a rate limit parses, is keyed by 40-character shas, and re-running with a fetcher that always succeeds only fetches the missing commits.
5. **Verbatim:** every `pr.excerpt` and issue excerpt in the output is a substring of the collapsed body the fetcher returned.
6. **Revert predicate is one function:** `isRevertCause`, `hauntLevel`, and `revival-tracker` agree with `isRevertSubject` on generated subjects (including `Reverting N`, `reverted`, `Revertible`, mixed case); a source-scan test fails if a revert regex or `startsWith('Revert')` appears outside `src/core/revert.ts`.
7. **Level monotonicity (kept):** raising `warn` or `block` never raises a level; never `block` without a reason; `aliveAtHead` non-Revert is always `none`; an aliveAtHead Revert at similarity >= 0.7 is `block`. Added: attaching an obituary to a tombstone never lowers its level, and never raises it above `block` unless similarity >= the block threshold.
8. **Link kinds:** for any message, `parseLinks` never returns two links with the same `ref`; a bare `#N` is `ref`; with `repoUrl` every link has a `url`, and without it only URL-form links do.
9. **Display:** the hook entry with an obituary is <= 1,200 characters for any excerpt and cause lengths, and contains the id, commit, and line range.

### REQ-9: Measurement and acceptance

- **Revert predicate impact.** Before changing it, a script in `research/` counts, on the 6 research repos, tombstones whose Revert status or level changes and revivals whose `isRevert` changes. The numbers go into `research/obituary-eval.md` with the commit subjects of the changed cases (`evidence-first`: show, do not guess).
- **Coverage.** The same script reports, per repo, tombstones with a usable obituary after `obituary --limit 300`, and how many of the 17-of-77 reasonless Reverts gain one. Results are recorded as measured, whatever they are. Live runs are manual and not part of `npm test`.
- **Demo acceptance (offline).** A fixture graveyard plus a recorded fetcher response for `24bcb9e` / PR #5353 drives the hook for the `a36a5b6` tombstone: stderr contains the cause of death verbatim, the `Obituary (PR #5353): "A number of PRs were merged back in September …" https://github.com/psf/requests/pull/5353` line, and the tombstone is `block` at similarity >= 0.7. The recorded excerpt is copied from the real PR text at recording time.
- Core purity: `src/core` has no Node imports and no network. `src/obituary/` is the only place with `fetch`, `gh`, or `git remote`.

## Out of scope

- Fetching review comments, linked discussions, or issue comments. Only PR and issue bodies.
- GitHub Enterprise hosts, GitLab, other forges.
- Summarizing or classifying the reason (for example "release management"). The excerpt is shown as written; the agent reads it.
- Calling the obituary from `index`, the hook, or MCP. It is a separate, opt-in step.
