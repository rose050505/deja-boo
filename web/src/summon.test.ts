import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { DEMO_REPO, DEMO_SNIPPET, DEMO_STONE_ID } from './demo-snippet.ts';
import { fogDensity, ghostOpacity, restLine, summon } from './summon.ts';
import type { WebTombstone } from './data.ts';

const demo = JSON.parse(readFileSync(new URL('../public/graveyards/haunted-http.json', import.meta.url), 'utf8')) as WebTombstone[];

const requests = JSON.parse(readFileSync(new URL('../public/graveyards/requests.json', import.meta.url), 'utf8')) as WebTombstone[];
// The fixture's own snippet: the Revert-buried call with `raw` renamed to `response`.
const FIXTURE_SNIPPET = `class HTTPAdapter:
    def send(self, request, timeout=None):
        conn = self.pool.connection_for(request.url)
        chunked = not (request.body is None or "Content-Length" in request.headers)

        response = conn.urlopen(
            method=request.method,
            url=request.path,
            body=request.body,
            headers=request.headers,
            redirect=False,
            retries=self.max_retries,
            timeout=timeout,
            chunked=chunked,
        )

        return Response.from_raw(response, request)
`;

describe('summon', () => {
  it('the real requests demo raises the 2020 Revert stone at block, with its obituary line', () => {
    expect(DEMO_REPO).toBe('requests');
    const r = summon(requests, DEMO_SNIPPET);
    const h = r.hits.find(x => x.tombstone.id === DEMO_STONE_ID);
    expect(h).toBeDefined();
    expect(h!.level).toBe('block');
    expect(h!.tombstone.causeOfDeath).toMatch(/^Revert/);
    expect(h!.similarity).toBeGreaterThanOrEqual(0.7);
  });

  it('the haunted-http fixture still raises its stone', () => {
    const r = summon(demo, FIXTURE_SNIPPET);
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h.level).toBe('block');
    expect(h.similarity).toBeGreaterThanOrEqual(0.7);
    expect(h.tombstone.causeOfDeath).toMatch(/^Revert/);
    expect(h.matchedLines[0]).toBeGreaterThan(0);
  });

  it('property: acknowledging every hit makes them rest, and nothing else changes', () => {
    const r = summon(requests, DEMO_SNIPPET);
    const acked = summon(requests, `${DEMO_SNIPPET}\n# ${r.hits.map(h => `deja-boo: checked ${h.tombstone.id}`).join('\n# ')}`);
    expect(acked.hits).toHaveLength(0);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(acked.rested.map(h => h.tombstone.id)).toEqual(r.hits.map(h => h.tombstone.id));
  });

  it('unrelated code raises nothing', () => {
    expect(summon(demo, 'def add(a, b):\n    return a + b\n').hits).toEqual([]);
    expect(summon(demo, '').hits).toEqual([]);
  });

  it('property: hits are sorted by similarity and levels respect thresholds', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 30 }), lines => {
        const r = summon(requests, [...lines, ...DEMO_SNIPPET.split('\n')].join('\n'));
        for (const h of r.hits) expect(h.similarity).toBeGreaterThanOrEqual(0.5);
        for (let i = 1; i < r.hits.length; i++) expect(r.hits[i - 1]!.similarity).toBeGreaterThanOrEqual(r.hits[i]!.similarity);
      }),
      { numRuns: 25 },
    );
  });
});

describe('visual mappings', () => {
  it('ghost opacity and fog are monotone and bounded', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(ghostOpacity(lo)).toBeLessThanOrEqual(ghostOpacity(hi));
      expect(ghostOpacity(a)).toBeGreaterThanOrEqual(0.25);
    }));
    fc.assert(fc.property(fc.nat(50), n => {
      expect(fogDensity(n)).toBeLessThanOrEqual(fogDensity(n + 1));
      expect(fogDensity(n)).toBeLessThanOrEqual(0.7);
    }));
  });
  it('rest line carries the id', () => {
    expect(restLine('abc')).toBe('If the reason no longer applies, let it rest: add `deja-boo: checked abc`');
  });
});
