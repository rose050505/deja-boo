Reviewer: we compared the live page (https://rose050505.github.io/deja-boo/) side by side with five other Kiroween entries at 1440x900, and ran the CLI on pallets/click as a first-time user would. The tool is solid; the first ten seconds are not. This run records the whole plan in the specs and implements the first batch. Later runs will implement the other batches.

## What we saw (evidence)

1. Other entries open with one large sentence that names the problem, one button, and a payoff within about ten seconds (a stone rising and STOP, jars cracking, a scene playing). Ours opens with seven stat boxes whose labels need definitions ("tombstones listed", "comebacks of listed tombstones") and a grid of green stones from 2012 to 2016. The story's stone (requests, 2020-02-18 Revert, id a36a5b61502a…) is off screen to the right.
2. The demo button "Try the haunted chunked upload" switches to the fixture repo haunted-http (one stone) and shows 100%. The real requests graveyard already holds the real tombstone, with the PR #5353 obituary. Pasting the code Kiro wrote in our real-history test (below) into the requests graveyard gives a BLOCK with the obituary; with two identifiers renamed it still blocks at 82%. The real case is far more convincing than the fixture.
3. The page has no link to the demo video, the repository or the Devpost entry (the only link is "setup"), and no og:image, so shared links show no preview.
4. CLI: in click, `deja-boo check src/click/core.py` prints nothing at all and exits 0. A first-time user cannot tell a clean result from a broken install.
5. CLI: `deja-boo index` in click (3,416 commits, 13 s) ends with counters only ("Revivals found: 3", "10 Reverts stay watched"). The comebacks in the user's own history, which are the point of the tool, are not shown, and there is no next step.
6. A tester from another team asked "how do I use this on my repo?". The page can only check against the sample graveyards.

## Part 1: record the plan in the specs (do this first)

Add the requirements and tasks below to the existing specs, in the existing style (EARS lines, numbered tasks, one batch per heading). Keep the old requirements; where a new one replaces an old line (REQ-3's demo button, REQ-4's stat strip), edit that line and say what replaced it.

- `haunted-graveyard`:
  - **Batch E (this run): judge path.** E1 the demo button pastes the real requests code (below), selects requests and summons; it must raise a36a5b61502a63ed9b4b2b875e7420e118a72156 at block with the obituary line. haunted-http stays as the last chip, labelled as a fixture. E2 header links (Demo video https://youtu.be/E0bHgE6uA8I, Repository https://github.com/rose050505/deja-boo, Devpost https://devpost.com/software/deja-boo) and Open Graph / Twitter card meta with an image.
  - **Batch F: first screen.** F1 a hero: one large sentence, one subline, one primary button (the E1 demo) and the video link, above the fold at 1440x900 and at 375 px. Proposed copy: "Your AI agent just rewrote code that was reverted in 2020." / "Déjà Boo stops it, and shows why the code died." F2 three headline numbers taken from `stats.json` (commits walked; comebacks found, and how many a reviewer confirmed real by hand: 26 and 20, from README "Why it matters"; comebacks via Revert, all real), with the remaining numbers and their definitions moved into a collapsed "How we counted" block that keeps today's wording. Every number on the page must come from `stats.json` or be quoted from the README with a link to its evidence file (`research/labels/`, `research/matching-eval.md`). F3 the requests graveyard opens scrolled to the 2020 Revert stone, with a short visible label next to it. F4 a three-step "For judges" strip: watch the video, press the demo button, run `index` and `check` on your own repo (Node 24+). F5 hovering or focusing a stone shows its epitaph next to the stone, not only in the caption under the grid.
  - **Batch G: the moment it blocks.** G1 when a summon hits: scroll to the stone, shake it, raise a large ghost (3 to 4 times today's glyph, opacity still = similarity), briefly tint the page edge blood red and stamp "BLOCKED: the Kiro hook would stop this write" (warn: "WARN" in the normal palette, no red), then show the evidence card next to or right under the graveyard so stone and evidence are on one screen. G2 atmosphere drawn in CSS/SVG only (no photos, no third-party art): night sky gradient with a moon above the graveyard, a ground strip under the stones, stone shading and texture, a slow faint fog that is always present and thickens with active hits. One display font for the title, an OFL font committed to the repo (no external font CDN). Reading surfaces (dialog, code, cards) stay plain and readable. G3 an opt-in sound toggle (default off) that plays one short synthesized sound when a ghost rises (Web Audio, generated in code, no audio files).
  - **Batch H: your own graveyard.** H1 drag and drop (and a file picker) for a `.deja-boo/graveyard.json` written by `deja-boo index`: it is read in the browser only, validated, drawn as its own graveyard and becomes the summon target. Nothing is uploaded. A malformed file gives a plain error and changes nothing. It must handle the size of our largest sample (express, 1.3 MB) without freezing.
  - All batches: `prefers-reduced-motion` disables shake, float, fog drift and the tint animation (static states instead); every visual state keeps a text equivalent; contrast stays AA and the contrast test covers any new colour.
- `revenant-watch`: **check feedback.** When `check` finds nothing, print one line to stderr, for example `✓ clean: src/click/core.py checked against 745 tombstones` (with `--no-head` or `-`, say what was checked). Stdout and exit codes do not change; the hook and Stop commands do not print it.
- `graveyard-miner`: **index summary.** After the counters, `index` prints up to 5 comebacks found in this repository's history (path, death date, first line of the cause, the commit that brought it back and its date), newest first, or "No comebacks found in history." Then a next-step line: `Next: deja-boo check <file> · hooks: see README "Use it on your repo" · view it: drop .deja-boo/graveyard.json on https://rose050505.github.io/deja-boo/`. Batch H must exist before the last part of that line is true; add it in the same batch as H.

## Part 2: implement batch E now, plus the `check` feedback

- E1. Replace `web/src/demo-snippet.ts` with the code below (what Kiro wrote in `requests/adapters.py` in our real-history test, `docs/kiro-runs/rehearsal_requests2023_guarded.diff`, without the acknowledgement comment). `DEMO_REPO = 'requests'`. Button text: "Paste what Kiro wrote (real requests history)". Update `summon.test.ts` so it loads `web/public/graveyards/requests.json` and asserts the hit a36a5b61502a63ed9b4b2b875e7420e118a72156 at block. Keep a test that the haunted-http fixture still raises its stone. Label the haunted-http chip "haunted-http (fixture)" or similar, without changing the data file name.

```python
    def send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
        conn = self.get_connection(request.url, proxies)
        url = self.request_url(request, proxies)
        chunked = not (request.body is None or "Content-Length" in request.headers)

        try:
            resp = conn.urlopen(
                method=request.method,
                url=url,
                body=request.body,
                headers=request.headers,
                redirect=False,
                assert_same_host=False,
                preload_content=False,
                decode_content=False,
                retries=self.max_retries,
                timeout=timeout,
                chunked=chunked,
            )

        except (ProtocolError, OSError) as err:
            raise ConnectionError(err, request=request)
```

  If the matcher does not reach block on this text, stop and say so with the number; do not change thresholds.
- E2. Header links as above (open in a new tab, `rel="noopener noreferrer"`). Copy `docs/media/devpost-thumbnail.jpg` to `web/public/og.jpg`; add `og:title`, `og:description`, `og:image` (absolute: `https://rose050505.github.io/deja-boo/og.jpg`), `og:url`, `twitter:card` = `summary_large_image`.
- `check` feedback from the revenant-watch section, with a test.

Done means: the three spec files updated (tasks for E and the check feedback ticked, F, G, H and the index summary left open), batch E and the check feedback implemented with tests. `npm test`, `npx tsc --noEmit`, `npm run build` and `npm run web:build` pass. Commit with a message ending in "(Kiro CLI)". Don't push. Report what you changed, anything you could not do, and the similarity the demo snippet reached.
