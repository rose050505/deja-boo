Reviewer: the obituary spec is approved. Answers to the open questions in design.md:
1. Yes: a bare `#N` with no obituary still counts as a reason (no level changes without an obituary file).
2. Agree with the split: silent in hook/Stop/check_snippet/ghost card when there is no obituary; `check` and `get_tombstone` say "not fetched" / "none found" only when an obituary file exists. When an obituary exists, the hook and Stop messages DO show the one-line obituary (that's the point).
3. Don't commit `.deja-boo/obituaries.json` for this repo. But `npm run web:data` must bake obituaries into `web/public/graveyards/*.json` when an obituaries file is present for a research repo, so the live site shows them.
4. `'ref'` is fine; update every reader in this repo.

Please implement **Batches A, B and C** (Tasks 1–9) now, in order, with each batch ending green (`npm test`, `npx tsc --noEmit`). Notes:
- Task 1 (measure the Revert predicate change) goes into research/ with before/after counts on the 6 research repos (clones under ../probe/repos/, as in research §6).
- Tests never touch the network: inject the fetcher. The real fetcher (Task 8) may use `GITHUB_TOKEN`, then `gh auth token` (gh is installed and logged in on this machine), else unauthenticated.
- After Task 9, do one real smoke run against psf/requests using the local clone at ../probe/repos/requests: `deja-boo index` then `deja-boo obituary --repo psf/requests --limit 40`, and show that death commit 24bcb9eab60d2db5e71979ea391b3e5675daff1f gets PR #5353 with the verbatim excerpt that begins "A number of PRs were merged back in September without any proper review". Report the request count and time. Don't commit the generated obituaries file.
- Mark tasks [x] in tasks.md as you finish them. Commit at the end with a message ending in "(Kiro CLI)". Don't push.
