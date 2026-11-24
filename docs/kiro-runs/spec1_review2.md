Review comments after a real-repo smoke test (expressjs/express, 5,701 commits, indexed in 1.7 s — great):

1. BUG — revivals dated BEFORE the death they refer to. Examples from express:
   - test/res.send.js died 2012-12-06 ('Revert "add 'etag' option"'), revival dated 2012-11-19.
   - test/res.jsonp.js died 2014-05-08, revival dated 2014-05-02.
   The property "revivals are always later than their death" passes on synthetic data but fails on real history, because branches make commit dates non-monotonic with respect to processing order. Fix: stream with `git log --reverse --topo-order --no-merges`, use committer date (%ct) for all date logic (buriedAt, grace window, revival gap), and keep author date only as display metadata. Add a fixture-repo test with a merged side branch whose author dates go backwards, and make the revival-order property generate non-monotonic dates.

2. MISSING — there is no executable CLI entry point. Add src/cli/main.ts with a shebang, subcommand dispatch (`index` now; `check` and `hook` will come in spec 2), `--help`, and a "bin": { "deja-boo": "dist/cli/main.js" } entry in package.json. `npx deja-boo index <repo>` must work after `npm run build`.

3. Default skip list: add generated docs (`docs/**/*.html`, `*.min.*` already), `CHANGELOG*`, `HISTORY*`, and `*.snap`.

Keep all existing tests green; update tasks.md with a short "post-review fixes" section.
