import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { recordRevival, recordReDeath, scanForRevivals } from './revival-tracker.js';
import type { MinerConfig, Tombstone, ParsedCommit, Hunk } from '../core/types.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import { normalizeBlock } from '../core/normalize.js';
import { kgramWinnow } from '../core/fingerprint.js';

const CFG: MinerConfig = {
  ...DEFAULT_MINER_CONFIG,
  kgramSize: 3,
  windowSize: 2,
  minBlockLines: 4,
};

const RICH_LINES = [
  'function fetchUser(id) {',
  '  const url = buildUrl(id);',
  '  return fetch(url).then(r => r.json());',
  '}',
];

function richFp(lines = RICH_LINES): number[] {
  return kgramWinnow(normalizeBlock(lines, CFG), CFG);
}

function makeTombstone(buriedAt: string, lines = RICH_LINES): Tombstone {
  return {
    id: 'ts1',
    fingerprint: richFp(lines),
    lines,
    path: 'src/x.ts',
    language: 'typescript',
    buriedAt,
    buriedAtTimestamp: Math.floor(new Date(buriedAt).getTime() / 1000),
    commit: 'a'.repeat(40),
    author: 'dev@example.com',
    causeOfDeath: 'removed caching',
    links: [],
    revivals: [],
    deaths: [],
  };
}

function makeMeta(
  date: string,
  subject = 'restore feature',
  hash = 'b'.repeat(40),
): ParsedCommit['meta'] {
  return {
    hash,
    authorEmail: 'dev@example.com',
    subject,
    body: '',
    authorDate: date,
    committerTimestamp: Math.floor(new Date(date).getTime() / 1000),
  };
}

function makeHunk(addedLines: string[] = [], deletedLines: string[] = []): Hunk {
  return { filePath: 'src/x.ts', oldStart: 1, newStart: 1, deletedLines, addedLines };
}

function makeCommit(date: string, added: string[] = [], deleted: string[] = []): ParsedCommit {
  return {
    meta: makeMeta(date),
    hunks: [makeHunk(added, deleted)],
  };
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('recordRevival', () => {
  it('appends exactly one revival record with correct fields', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    recordRevival(t, makeMeta('2024-01-20T00:00:00Z', 'restore feature'), 0.95);
    expect(t.revivals).toHaveLength(1);
    expect(t.revivals[0]!.similarity).toBe(0.95);
    expect(t.revivals[0]!.isRevert).toBe(false);
    // date is derived from committerTimestamp; .000Z is valid ISO 8601
    expect(new Date(t.revivals[0]!.date).toISOString()).toBe('2024-01-20T00:00:00.000Z');
  });

  it('subject starting with "Revert" sets isRevert: true', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    recordRevival(t, makeMeta('2024-01-20T00:00:00Z', 'Revert "remove caching"'), 1.0);
    expect(t.revivals[0]!.isRevert).toBe(true);
  });

  it('subject not starting with "Revert" sets isRevert: false', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    recordRevival(t, makeMeta('2024-01-20T00:00:00Z', 'add caching back'), 1.0);
    expect(t.revivals[0]!.isRevert).toBe(false);
  });

  it('multiple revivals are ordered by date ascending', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    recordRevival(t, makeMeta('2024-03-01T00:00:00Z'), 0.9);
    recordRevival(t, makeMeta('2024-02-01T00:00:00Z'), 0.95);
    expect(new Date(t.revivals[0]!.date).getTime()).toBeLessThan(new Date(t.revivals[1]!.date).getTime());
    expect(new Date(t.revivals[0]!.date).toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(new Date(t.revivals[1]!.date).toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });
});

describe('recordReDeath', () => {
  it('appends a death record after a revival', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    recordRevival(t, makeMeta('2024-01-20T00:00:00Z'), 1.0);
    recordReDeath(t, { lines: RICH_LINES }, makeMeta('2024-02-10T00:00:00Z'), CFG);
    expect(t.deaths).toHaveLength(1);
    expect(new Date(t.deaths[0]!.date).toISOString()).toBe('2024-02-10T00:00:00.000Z');
    expect(t.deaths[0]!.similarity).toBeGreaterThan(0);
  });

  it('deaths are ordered by date ascending after multiple events', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    recordRevival(t, makeMeta('2024-01-20T00:00:00Z'), 1.0);
    recordReDeath(t, { lines: RICH_LINES }, makeMeta('2024-03-01T00:00:00Z'), CFG);
    recordReDeath(t, { lines: RICH_LINES }, makeMeta('2024-02-15T00:00:00Z'), CFG);
    expect(new Date(t.deaths[0]!.date).getTime()).toBeLessThan(new Date(t.deaths[1]!.date).getTime());
    expect(new Date(t.deaths[0]!.date).toISOString()).toBe('2024-02-15T00:00:00.000Z');
    expect(new Date(t.deaths[1]!.date).toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });
});

describe('scanForRevivals', () => {
  it('a re-add beyond the grace period appends a revival to the matching tombstone', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    const tombstones = new Map([['ts1', t]]);
    const commit = makeCommit('2024-02-01T00:00:00Z', RICH_LINES);
    scanForRevivals(tombstones, commit, CFG);
    expect(t.revivals).toHaveLength(1);
  });

  it('a subsequent deletion after revival appends a death record', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    const tombstones = new Map([['ts1', t]]);
    // First: revival
    scanForRevivals(tombstones, makeCommit('2024-02-01T00:00:00Z', RICH_LINES), CFG);
    // Then: re-deletion
    scanForRevivals(tombstones, makeCommit('2024-03-01T00:00:00Z', [], RICH_LINES), CFG);
    expect(t.revivals).toHaveLength(1);
    expect(t.deaths).toHaveLength(1);
  });

  it('no revival is recorded when no added blocks match', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z');
    const tombstones = new Map([['ts1', t]]);
    const commit = makeCommit('2024-02-01T00:00:00Z', ['x x x x', 'y y y y', 'z z z z', 'w w w w']);
    scanForRevivals(tombstones, commit, CFG);
    expect(t.revivals).toHaveLength(0);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('revival-tracker – property tests', () => {
  const richLine = fc.stringMatching(/^[a-z]{4} [a-z]{4} [a-z]{4}[a-z]*$/);
  const richBlock = fc.array(richLine, { minLength: 4, maxLength: 8 });

  it('Property 1: every revival date is strictly after tombstone.buriedAt', () => {
    fc.assert(
      fc.property(
        richBlock,
        fc.integer({ min: 1, max: 365 }),
        (lines, daysAfter) => {
          const fp = richFp(lines);
          if (fp.length === 0) return true;
          const buriedAt = '2024-01-01T00:00:00Z';
          const t = makeTombstone(buriedAt, lines);
          const revivalDate = new Date(
            Date.parse(buriedAt) + daysAfter * 86_400_000,
          ).toISOString();
          recordRevival(t, makeMeta(revivalDate), 1.0);
          return t.revivals.every(r => r.date > t.buriedAt);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 2: re-deaths are always after the preceding revival', () => {
    fc.assert(
      fc.property(
        richBlock,
        fc.integer({ min: 1, max: 180 }),
        fc.integer({ min: 1, max: 180 }),
        (lines, revivalDaysAfter, deathDaysAfterRevival) => {
          const fp = richFp(lines);
          if (fp.length === 0) return true;
          const buriedAt = '2024-01-01T00:00:00Z';
          const t = makeTombstone(buriedAt, lines);
          const buriedMs = Date.parse(buriedAt);
          const revivalDate = new Date(buriedMs + revivalDaysAfter * 86_400_000).toISOString();
          const deathDate = new Date(
            Date.parse(revivalDate) + deathDaysAfterRevival * 86_400_000,
          ).toISOString();
          recordRevival(t, makeMeta(revivalDate), 1.0);
          recordReDeath(t, { lines }, makeMeta(deathDate), CFG);
          if (t.deaths.length === 0 || t.revivals.length === 0) return true;
          return t.deaths[0]!.date > t.revivals[0]!.date;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 3: revivals-after-death holds even with non-monotonic author dates', () => {
    // Generates committerTimestamps that increase while authorDate can go backwards,
    // mirroring a merged side-branch in real history.
    fc.assert(
      fc.property(
        richBlock,
        // burial committerTs: some base in 2024
        fc.integer({ min: 1_700_000_000, max: 1_710_000_000 }),
        // revival committerTs: strictly after burial
        fc.integer({ min: 1, max: 86_400 * 30 }),
        // author date offset can be negative (branch authored before burial)
        fc.integer({ min: -86_400 * 365, max: 86_400 * 365 }),
        (lines, burialTs, revivalTsDelta, authorOffsetSec) => {
          const fp = richFp(lines);
          if (fp.length === 0) return true;

          const burialTs2 = burialTs;
          const revivalTs = burialTs2 + revivalTsDelta; // always after burial
          // authorDate can be before burialTs — simulates non-monotonic author dates
          const authorTs = burialTs2 + authorOffsetSec;

          const buriedAt = new Date(burialTs2 * 1000).toISOString();
          const t = makeTombstone(buriedAt, lines);
          // Override buriedAtTimestamp to use our controlled value
          t.buriedAtTimestamp = burialTs2;

          const meta: ParsedCommit['meta'] = {
            hash: 'c'.repeat(40),
            authorEmail: 'dev@example.com',
            subject: 'restore feature',
            body: '',
            authorDate: new Date(authorTs * 1000).toISOString(), // may be before burial
            committerTimestamp: revivalTs,                        // always after burial
          };

          recordRevival(t, meta, 1.0);
          if (t.revivals.length === 0) return true;

          // The revival date (from committerTimestamp) must be after the burial date
          const revivalDateMs = new Date(t.revivals[0]!.date).getTime();
          return revivalDateMs > burialTs2 * 1000;
        },
      ),
      { numRuns: 300 },
    );
  });
});
