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
