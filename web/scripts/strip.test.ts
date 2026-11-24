import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Tombstone } from '../../src/core/types.ts';
import { fingerprintLines } from '../../src/core/match.ts';
import { MAX_LINES, isWatched, stripGraveyard, stripTombstone } from './strip.ts';

const fp = (lines: string[]) => fingerprintLines(lines);

const tomb = (over: Partial<Tombstone> = {}): Tombstone => ({
  id: 'a'.repeat(40),
  fingerprint: [3, 1, 2],
  lines: ['x = 1'],
  path: 'src/a.ts',
  language: 'typescript',
  buriedAt: '2025-01-01T00:00:00+00:00',
  buriedAtTimestamp: 1,
  commit: 'b'.repeat(40),
  author: 'someone@example.invalid',
  causeOfDeath: 'Remove it',
  links: [],
  revivals: [],
  deaths: [],
  ...over,
});

const tombArb = fc.record({
  lines: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 150 }),
  alive: fc.boolean(),
  cause: fc.constantFrom('Remove it', 'Revert "x"', 'revert: y', ''),
});

describe('stripTombstone', () => {
  it('keeps exactly the web fields', () => {
    const out = stripTombstone(tomb({ aliveAtHead: true }), fp);
    expect(Object.keys(out).sort()).toEqual(
      ['aliveAtHead', 'causeOfDeath', 'commit', 'fingerprint', 'id', 'language', 'lines', 'links', 'path', 'revivals', 'buriedAt'].sort(),
    );
  });

  it('keeps an uncapped tombstone unchanged, without totalLines', () => {
    const t = tomb();
    const out = stripTombstone(t, fp);
    expect(out.fingerprint).toEqual(t.fingerprint);
    expect('totalLines' in out).toBe(false);
  });

  it('caps long tombstones, records the true count, and fingerprints the kept lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `const value${i} = compute(${i}, "item-${i}");`);
    const out = stripTombstone(tomb({ lines }), fp);
    expect(out.lines).toHaveLength(MAX_LINES);
    expect(out.totalLines).toBe(100);
    expect(out.fingerprint).toEqual(fp(lines.slice(0, MAX_LINES)).sort((a, b) => a - b));
  });

  it('property: lines never exceed the cap and are a prefix of the original', () => {
    fc.assert(
      fc.property(tombArb, ({ lines }) => {
        const out = stripTombstone(tomb({ lines }), fp);
        expect(out.lines.length).toBeLessThanOrEqual(MAX_LINES);
        expect(lines.slice(0, out.lines.length)).toEqual(out.lines);
        expect(out.totalLines === undefined).toBe(lines.length <= MAX_LINES);
      }),
    );
  });
});

describe('stripGraveyard', () => {
  it('drops alive tombstones except Reverts', () => {
    expect(isWatched(tomb({ aliveAtHead: true }))).toBe(false);
    expect(isWatched(tomb({ aliveAtHead: true, causeOfDeath: 'Revert "x"' }))).toBe(true);
    expect(isWatched(tomb())).toBe(true);
  });

  it('property: deterministic, unique ids, no unwatched survivors', () => {
    fc.assert(
      fc.property(fc.array(tombArb, { maxLength: 8 }), items => {
        const ts = items.map((it, i) =>
          tomb({ id: String(i).padStart(40, '0'), lines: it.lines, aliveAtHead: it.alive, causeOfDeath: it.cause }),
        );
        const a = stripGraveyard(ts, fp);
        const b = stripGraveyard([...ts].reverse(), fp);
        expect(a).toEqual(b);
        expect(new Set(a.map(t => t.id)).size).toBe(a.length);
        for (const t of a) expect(t.aliveAtHead !== true || /^revert/i.test(t.causeOfDeath)).toBe(true);
      }),
    );
  });
});

describe('obituary in the web record', () => {
  const o = { pr: { number: 5353, url: 'https://github.com/psf/requests/pull/5353', title: 't', excerpt: 'No review.', truncated: false }, issues: [], fetchedAt: '2026-05-01T00:00:00Z' };
  it('is kept when it has text, with the other fields unchanged', () => {
    const plain = stripTombstone(tomb(), fp);
    const out = stripTombstone(tomb({ obituary: o }), fp);
    expect(out.obituary).toEqual(o);
    const { obituary: _o, ...rest } = out;
    expect(rest).toEqual(plain);
  });
  it('is dropped when it has no text; JSON without obituaries is byte-identical', () => {
    const plain = JSON.stringify(stripGraveyard([tomb()], fp));
    expect(JSON.stringify(stripGraveyard([tomb({ obituary: { ...o, pr: { ...o.pr, excerpt: '' } } })], fp))).toBe(plain);
    expect(JSON.stringify(stripGraveyard([tomb({ obituary: { pr: null, issues: [], fetchedAt: o.fetchedAt } })], fp))).toBe(plain);
  });
  it('a full-size obituary adds under 1 KB per tombstone (it counts in the 3 MB limit and is never trimmed)', () => {
    const big = { ...o, pr: { ...o.pr, excerpt: 'x'.repeat(400), truncated: true } };
    const grown = JSON.stringify(stripTombstone(tomb({ obituary: big }), fp)).length - JSON.stringify(stripTombstone(tomb(), fp)).length;
    expect(grown).toBeLessThan(1024);
    expect(JSON.stringify(stripTombstone(tomb({ obituary: big, lines: Array.from({ length: 150 }, (_, i) => `l${i}`) }), fp))).toContain('x'.repeat(400));
  });
});
