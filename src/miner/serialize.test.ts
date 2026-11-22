import { describe, it, expect } from 'vitest';
import { toGraveyardJson, fromGraveyardJson } from './serialize.js';
import type { Graveyard } from '../core/types.js';

function makeGraveyard(overrides: Partial<Graveyard> = {}): Graveyard {
  return {
    tombstones: [],
    stats: {
      commits: 10,
      tombstones: 0,
      revivals: 0,
      revivalsViaRevert: 0,
      medianRevivalGapDays: null,
    },
    ...overrides,
  };
}

const FULL_GRAVEYARD: Graveyard = {
  tombstones: [
    {
      id: 'abc123',
      fingerprint: [1, 2, 3],
      lines: ['function foo() {', '  return 42;', '}', 'export default foo;'],
      path: 'src/foo.ts',
      language: 'typescript',
      buriedAt: '2024-01-15T00:00:00Z',
      commit: 'a'.repeat(40),
      author: 'dev@example.com',
      causeOfDeath: 'removed legacy helper',
      links: [{ type: 'issue', ref: '42' }],
      revivals: [
        {
          commit: 'b'.repeat(40),
          date: '2024-02-20T00:00:00Z',
          author: 'other@example.com',
          subject: 'restore foo helper',
          similarity: 0.95,
          isRevert: false,
        },
      ],
      deaths: [
        {
          commit: 'c'.repeat(40),
          date: '2024-03-10T00:00:00Z',
          author: 'dev@example.com',
          causeOfDeath: 'removed again, still leaks',
          links: [],
          fingerprint: [1, 2, 3],
          lines: ['function foo() {', '  return 42;', '}', 'export default foo;'],
          similarity: 1.0,
        },
      ],
    },
  ],
  stats: {
    commits: 50,
    tombstones: 1,
    revivals: 1,
    revivalsViaRevert: 0,
    medianRevivalGapDays: 36,
  },
};

describe('toGraveyardJson / fromGraveyardJson', () => {
  it('round-trip: fromGraveyardJson(toGraveyardJson(g)) deep-equals g', () => {
    const json = toGraveyardJson(FULL_GRAVEYARD);
    const roundTripped = fromGraveyardJson(json);
    expect(roundTripped).toEqual(FULL_GRAVEYARD);
  });

  it('two calls with the same input produce byte-identical output', () => {
    const a = toGraveyardJson(FULL_GRAVEYARD);
    const b = toGraveyardJson(FULL_GRAVEYARD);
    expect(a).toBe(b);
  });

  it('keys in output JSON are alphabetically ordered at the top level', () => {
    const json = toGraveyardJson(makeGraveyard());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it('keys inside stats are alphabetically ordered', () => {
    const json = toGraveyardJson(makeGraveyard());
    const parsed = JSON.parse(json) as { stats: Record<string, unknown> };
    const keys = Object.keys(parsed.stats);
    expect(keys).toEqual([...keys].sort());
  });

  it('keys inside each tombstone are alphabetically ordered', () => {
    const json = toGraveyardJson(FULL_GRAVEYARD);
    const parsed = JSON.parse(json) as { tombstones: Record<string, unknown>[] };
    const keys = Object.keys(parsed.tombstones[0]!);
    expect(keys).toEqual([...keys].sort());
  });

  it('a graveyard with revivals and deaths round-trips correctly', () => {
    const json = toGraveyardJson(FULL_GRAVEYARD);
    const rt = fromGraveyardJson(json);
    expect(rt.tombstones[0]!.revivals).toHaveLength(1);
    expect(rt.tombstones[0]!.deaths).toHaveLength(1);
    expect(rt.tombstones[0]!.revivals[0]!.similarity).toBe(0.95);
    expect(rt.tombstones[0]!.deaths[0]!.similarity).toBe(1.0);
  });

  it('pretty-prints with 2-space indentation', () => {
    const json = toGraveyardJson(makeGraveyard());
    // Every indented line uses exactly 2 spaces per level.
    const lines = json.split('\n');
    for (const line of lines) {
      const indent = line.match(/^( *)/)?.[1] ?? '';
      expect(indent.length % 2).toBe(0);
    }
  });
});
