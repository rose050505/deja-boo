Reviewer: a new spec, from the functional review of Déjà Boo. Please create `.kiro/specs/obituary/` (requirements.md in EARS, design.md, tasks.md) the same way as the other specs. Don't implement yet; I'll review the spec first.

## Why (measured)
- Most tombstones carry no reason. Share of tombstones whose death commit has no body and no link: express 76%, flask 80%, requests 68%, got 56% (counted from web/public/graveyards/*.json). The cause of death today is only the commit subject + body (src/miner/build-tombstone.ts).
- Reverts are worse: only 17 of 77 Revert tombstones across the 6 repos give a reason beyond "This reverts commit …" (express 0/14, requests 5/27).
- The demo scene shows the cost. In psf/requests, tombstone a36a5b6 was buried by 24bcb9e, a bare revert. In every guarded take, Kiro said "the revert gives no reason" and had to stop and ask. But the pull request that made the revert, psf/requests#5353 (found with `gh api repos/psf/requests/commits/24bcb9eab60d2db5e71979ea391b3e5675daff1f/pulls`), says why: "A number of PRs were merged back in September without any proper review … I'm going to revert for now to get 2.23.0 out the door, and we can revisit them afterwards as needed." That is a release-management reason, not a technical defect, and it tells the agent exactly what to check.
- 1,595 links have no URL (axios 434, got 460), and every bare #N is classified as "issue" (src/miner/link-parser.ts), so an agent can't follow them.

## What to build: the obituary
1. `deja-boo obituary [--repo owner/name] [--limit N]`: an opt-in enrichment step after `index`. The core miner, check, hook and MCP must keep working offline and unchanged when no obituary file exists.
   - It finds the GitHub repo from `--repo` or `git remote get-url origin`.
   - For a prioritized set of death commits (Revert tombstones first, then tombstones that were revived, then tombstones with links; capped by `--limit`, default 300), it asks GitHub for the pull request(s) that contain the commit (`GET /repos/{o}/{r}/commits/{sha}/pulls`) and for linked issues/PRs mentioned in the commit message (`GET /repos/{o}/{r}/issues/{n}`).
   - Auth: `GITHUB_TOKEN` env if set, else `gh auth token` if `gh` is installed, else unauthenticated (low rate limit); on rate limit it stops cleanly and writes what it has.
   - Output: `.deja-boo/obituaries.json`, keyed by death commit sha: `{ pr: {number, url, title, excerpt}, issues: [{number, url, title, excerpt}], fetchedAt }`. `excerpt` is the first ≤400 characters of the body, verbatim (whitespace collapsed), never paraphrased or generated.
   - A fetcher is injected so tests never hit the network.
2. Index records the remote: `graveyard.json` gains `repoUrl` (https form) when the origin is GitHub, so bare `#N` links get a URL `https://github.com/<o>/<r>/issues/N` (GitHub redirects issue numbers that are PRs). Keep the link kind honest: "ref" when unknown, not "issue".
3. Everywhere a tombstone is shown, the obituary appears under the cause of death when present: the hook/Stop message (one line: `Obituary (PR #5353): "…excerpt…" <url>`), MCP `get_tombstone` (full record), `deja-boo check` output, and the web app's tombstone dialog and ghost card. If none: say nothing new (no invented text).
4. Block evidence: today a block needs a Revert or any `#N` (src/core/level.ts). With obituaries, "has a reason" means: a Revert, or an obituary/linked issue with non-empty text. Also fix the inconsistency between `/^revert/i` (alive filter) and `/^revert\b/i` (level) — "reverting 3362" style subjects must be treated the same in both places. Keep the monotonicity property tests.
5. Web data: `npm run web:data` uses obituaries when present so the live demo shows them for the 6 repos.

## Properties to require (testing steering)
- Excerpts are verbatim substrings of the fetched body (after whitespace collapse) and ≤400 chars.
- With no obituary file, every existing output is byte-for-byte unchanged.
- The fetcher is called at most `--limit` times plus linked-issue lookups; a rate-limit response stops the run and keeps partial results.
- Revert detection is the same function in every module.

Keep `evidence-first` in mind: never invent a cause of death; when the obituary is missing, say so.
