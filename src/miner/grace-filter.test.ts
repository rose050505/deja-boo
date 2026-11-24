import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyGrace } from './grace-filter.js';
import type { MinerConfig, Tombstone, ParsedCommit, Hunk } from '../core/types.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';

const CFG: Pick<
  MinerConfig,
  'graceDays' | 'aliveAfterDeath' | 'kgramSize' | 'windowSize' | 'renameIds' | 'minBlockLines'
> = {
  ...DEFAULT_MINER_CONFIG,
  kgramSize: 3,
  windowSize: 2,
  graceDays: 7,
  aliveAfterDeath: 0.9,
  minBlockLines: 4,
};

// Lines that always survive normalisation and produce non-empty fingerprints.
const RICH_LINES = [
  'function fetchUser(id) {',
  '  const url = buildUrl(id);',
  '  return fetch(url).then(r => r.json());',
  '}',
];

function makeTombstone(buriedAt: string, fingerprint: number[]): Tombstone {
  return {
    id: 'ts-' + buriedAt,
    fingerprint,
    lines: RICH_LINES,
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

function makeHunkWithLines(lines: string[]): Hunk {
  return {
    filePath: 'src/x.ts',
    oldStart: 1,
    newStart: 1,
    deletedLines: [],
    addedLines: lines,
  };
}

function makeCommit(date: string, addedLines: string[]): ParsedCommit {
  return {
    meta: {
      hash: 'b'.repeat(40),
      authorEmail: 'dev@example.com',
      subject: 'restore caching',
      body: '',
      authorDate: date,
      committerTimestamp: Math.floor(new Date(date).getTime() / 1000),
    },
    hunks: [makeHunkWithLines(addedLines)],
  };
}

// Build a tombstone whose fingerprint matches RICH_LINES at the given config.
import { normalizeBlock } from '../core/normalize.js';
import { kgramWinnow } from '../core/fingerprint.js';

function richFingerprint(): number[] {
  const norm = normalizeBlock(RICH_LINES, CFG);
  return kgramWinnow(norm, CFG);
}

describe('applyGrace', () => {
  it('a tombstone re-added 3 days later (within 7-day grace) is dropped', () => {
    const fp = richFingerprint();
    const tombstone = makeTombstone('2024-01-01T00:00:00Z', fp);
    const pending = new Map([['ts-2024-01-01T00:00:00Z', tombstone]]);
    const commit = makeCommit('2024-01-04T00:00:00Z', RICH_LINES);
    const toDrop = applyGrace(pending, commit, CFG);
    expect(toDrop).toContain('ts-2024-01-01T00:00:00Z');
  });

  it('a tombstone re-added 10 days later is not dropped', () => {
    const fp = richFingerprint();
    const tombstone = makeTombstone('2024-01-01T00:00:00Z', fp);
    const pending = new Map([['ts-2024-01-01T00:00:00Z', tombstone]]);
    const commit = makeCommit('2024-01-11T00:00:00Z', RICH_LINES);
    const toDrop = applyGrace(pending, commit, CFG);
    expect(toDrop).toHaveLength(0);
  });

  it('a tombstone re-added in a commit with an unrelated block is not dropped', () => {
    const fp = richFingerprint();
    const tombstone = makeTombstone('2024-01-01T00:00:00Z', fp);
    const pending = new Map([['ts-2024-01-01T00:00:00Z', tombstone]]);
    // Commit adds completely different code — no overlap in fingerprint.
    const unrelated = ['x x x x', 'y y y y', 'z z z z', 'w w w w'];
    const commit = makeCommit('2024-01-04T00:00:00Z', unrelated);
    const toDrop = applyGrace(pending, commit, CFG);
    expect(toDrop).toHaveLength(0);
  });

  it('with graceDays: 0, no tombstone is ever dropped by the grace filter', () => {
    const fp = richFingerprint();
    const tombstone = makeTombstone('2024-01-01T00:00:00Z', fp);
    const pending = new Map([['ts-2024-01-01T00:00:00Z', tombstone]]);
    const commit = makeCommit('2024-01-01T00:00:00Z', RICH_LINES); // same day
    const toDrop = applyGrace(pending, commit, { ...CFG, graceDays: 0 });
    expect(toDrop).toHaveLength(0);
  });

  it('empty pending map returns empty list immediately', () => {
    const commit = makeCommit('2024-01-04T00:00:00Z', RICH_LINES);
    expect(applyGrace(new Map(), commit, CFG)).toEqual([]);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('applyGrace – property tests', () => {
  // A line format that always yields a non-empty fingerprint at kgramSize=3.
  const richLine = fc.stringMatching(/^[a-z]{4} [a-z]{4} [a-z]{4}[a-z]*$/);
  const richBlock = fc.array(richLine, { minLength: 4, maxLength: 8 });

  it('Property 1: grace re-add never creates a tombstone', () => {
    // Build a real fingerprint from fc-generated lines, then confirm that
    // applyGrace returns the tombstone id for a re-add within graceDays.
    fc.assert(
      fc.property(richBlock, fc.integer({ min: 1, max: 7 }), (lines, daysLater) => {
        const norm = normalizeBlock(lines, CFG);
        const fp = kgramWinnow(norm, CFG);
        if (fp.length === 0) return true; // skip degenerate case
        const buriedAt = '2024-06-01T00:00:00Z';
        const tombstone = makeTombstone(buriedAt, fp);
        const pending = new Map([[tombstone.id, tombstone]]);

        // Re-add the same lines within graceDays.
        const commitDate = new Date(
          Date.parse(buriedAt) + daysLater * 86_400_000,
        ).toISOString();
        const commit = makeCommit(commitDate, lines);
        const toDrop = applyGrace(pending, commit, CFG);
        return toDrop.includes(tombstone.id);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2: grace boundary is exclusive — re-add one day beyond graceDays is not dropped', () => {
    fc.assert(
      fc.property(richBlock, (lines) => {
        const norm = normalizeBlock(lines, CFG);
        const fp = kgramWinnow(norm, CFG);
        if (fp.length === 0) return true;
        const buriedAt = '2024-06-01T00:00:00Z';
        const tombstone = makeTombstone(buriedAt, fp);
        const pending = new Map([[tombstone.id, tombstone]]);

        // Exactly one day beyond graceDays (8 days when graceDays=7).
        const commitDate = new Date(
          Date.parse(buriedAt) + (CFG.graceDays + 1) * 86_400_000,
        ).toISOString();
        const commit = makeCommit(commitDate, lines);
        const toDrop = applyGrace(pending, commit, CFG);
        return !toDrop.includes(tombstone.id);
      }),
      { numRuns: 200 },
    );
  });
});
