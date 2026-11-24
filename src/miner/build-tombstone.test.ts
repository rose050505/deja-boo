import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildTombstone } from './build-tombstone.js';
import type { RawBlock, MinerConfig, ParsedCommit } from '../core/types.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';

const CONFIG: MinerConfig = {
  ...DEFAULT_MINER_CONFIG,
  kgramSize: 3,
  windowSize: 2,
};

function makeMeta(overrides: Partial<ParsedCommit['meta']> = {}): ParsedCommit['meta'] {
  return {
    hash: 'a'.repeat(40),
    authorEmail: 'dev@example.com',
    subject: 'remove old cache',
    body: '',
    authorDate: '2024-06-15T10:00:00Z',
    committerTimestamp: 1718445600,
    ...overrides,
  };
}

function makeBlock(lines: string[], filePath = 'src/cache.ts', hunkStart = 10): RawBlock {
  return { filePath, hunkStart, lines };
}

const LONG_BLOCK = [
  'function fetchUser(id) {',
  '  const url = buildUrl(id);',
  '  return fetch(url).then(r => r.json());',
  '}',
];

describe('buildTombstone', () => {
  it('same inputs always produce the same id', () => {
    const block = makeBlock(LONG_BLOCK);
    const meta = makeMeta();
    const t1 = buildTombstone(block, meta, CONFIG);
    const t2 = buildTombstone(block, meta, CONFIG);
    expect(t1).not.toBeNull();
    expect(t1!.id).toBe(t2!.id);
  });

  it('id changes when commit hash changes', () => {
    const block = makeBlock(LONG_BLOCK);
    const t1 = buildTombstone(block, makeMeta({ hash: 'a'.repeat(40) }), CONFIG);
    const t2 = buildTombstone(block, makeMeta({ hash: 'b'.repeat(40) }), CONFIG);
    expect(t1!.id).not.toBe(t2!.id);
  });

  it('empty-message commit produces causeOfDeath === "cause of death unknown"', () => {
    const block = makeBlock(LONG_BLOCK);
    const meta = makeMeta({ subject: '', body: '' });
    const t = buildTombstone(block, meta, CONFIG);
    expect(t).not.toBeNull();
    expect(t!.causeOfDeath).toBe('cause of death unknown');
  });

  it('whitespace-only subject produces causeOfDeath === "cause of death unknown"', () => {
    const block = makeBlock(LONG_BLOCK);
    const meta = makeMeta({ subject: '   ', body: '' });
    const t = buildTombstone(block, meta, CONFIG);
    expect(t!.causeOfDeath).toBe('cause of death unknown');
  });

  it('block too short after normalization returns null', () => {
    // With kgramSize=3, fewer than 3 tokens → empty fingerprint.
    const block = makeBlock(['x']);
    const t = buildTombstone(block, makeMeta(), CONFIG);
    expect(t).toBeNull();
  });

  it('links is populated from the commit message', () => {
    const block = makeBlock(LONG_BLOCK);
    const meta = makeMeta({ subject: 'fix memory leak, closes #42' });
    const t = buildTombstone(block, meta, CONFIG);
    expect(t!.links.some(l => l.ref === '42')).toBe(true);
  });

  it('fingerprint is sorted ascending', () => {
    const block = makeBlock(LONG_BLOCK);
    const t = buildTombstone(block, makeMeta(), CONFIG);
    expect(t).not.toBeNull();
    const fp = t!.fingerprint;
    for (let i = 1; i < fp.length; i++) {
      expect(fp[i]!).toBeGreaterThanOrEqual(fp[i - 1]!);
    }
  });

  it('buriedAt matches ISO 8601 authorDate from meta', () => {
    const block = makeBlock(LONG_BLOCK);
    const meta = makeMeta({ authorDate: '2025-01-01T00:00:00+09:00' });
    const t = buildTombstone(block, meta, CONFIG);
    expect(t!.buriedAt).toBe('2025-01-01T00:00:00+09:00');
  });

  it('language is detected from file path', () => {
    const block = makeBlock(LONG_BLOCK, 'src/module.py');
    const t = buildTombstone(block, makeMeta(), CONFIG);
    expect(t!.language).toBe('python');
  });

  it('revivals and deaths are initially empty arrays', () => {
    const block = makeBlock(LONG_BLOCK);
    const t = buildTombstone(block, makeMeta(), CONFIG);
    expect(t!.revivals).toEqual([]);
    expect(t!.deaths).toEqual([]);
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('buildTombstone – property tests', () => {
  // Generator that can produce blocks whose normalized content is empty
  // (comment-only lines, blank lines, single tokens) — these must be skipped.
  const anyLine = fc.oneof(
    fc.constant('// comment only'),
    fc.constant('#! /usr/bin/env node'),
    fc.constant('   '),
    fc.constant(''),
    fc.constant('{- haskell comment -}'),
    fc.string({ maxLength: 5 }), // often too short to fingerprint
  );
  const anyBlock = fc.array(anyLine, { minLength: 1, maxLength: 6 });

  // Generator that always produces a non-empty fingerprint.
  const richLine = fc.stringMatching(/^[a-z]{4} [a-z]{4} [a-z]{4}[a-z]*$/);
  const richBlock = fc.array(richLine, { minLength: 4, maxLength: 8 });

  it('Property: no tombstone ever has an empty fingerprint', () => {
    // anyBlock may yield null (empty fingerprint → skipped) or a tombstone.
    // When it yields a tombstone, the fingerprint must be non-empty.
    fc.assert(
      fc.property(anyBlock, (lines) => {
        const block = makeBlock(lines);
        const t = buildTombstone(block, makeMeta(), CONFIG);
        if (t === null) return true; // correctly skipped
        return t.fingerprint.length > 0;
      }),
      { numRuns: 500 },
    );
  });

  it('Property: same inputs always produce the same tombstone id', () => {
    fc.assert(
      fc.property(richBlock, (lines) => {
        const block = makeBlock(lines);
        const meta = makeMeta();
        const t1 = buildTombstone(block, meta, CONFIG);
        const t2 = buildTombstone(block, meta, CONFIG);
        if (t1 === null && t2 === null) return true;
        if (t1 === null || t2 === null) return false;
        return t1.id === t2.id;
      }),
      { numRuns: 200 },
    );
  });

  it('Property: fingerprint is always sorted ascending', () => {
    fc.assert(
      fc.property(richBlock, (lines) => {
        const t = buildTombstone(makeBlock(lines), makeMeta(), CONFIG);
        if (t === null) return true;
        for (let i = 1; i < t.fingerprint.length; i++) {
          if (t.fingerprint[i]! < t.fingerprint[i - 1]!) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe('buildTombstone – minHashes', () => {
  it('returns null below minHashes distinct hashes and builds above it', () => {
    const block = makeBlock(['try:', '  range_type = xrange', 'except NameError:', '  range_type = range']);
    const t = buildTombstone(block, makeMeta(), { ...CONFIG, minHashes: 0 });
    expect(t).not.toBeNull();
    const n = t!.fingerprint.length;
    expect(buildTombstone(block, makeMeta(), { ...CONFIG, minHashes: n })).not.toBeNull();
    expect(buildTombstone(block, makeMeta(), { ...CONFIG, minHashes: n + 1 })).toBeNull();
  });
  it('property: every built tombstone has at least minHashes hashes', () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-z ]{3,30}$/), { minLength: 1, maxLength: 12 }), fc.integer({ min: 0, max: 8 }), (lines, minHashes) => {
      const t = buildTombstone(makeBlock(lines), makeMeta(), { ...CONFIG, minHashes });
      return t === null || t.fingerprint.length >= minHashes;
    }));
  });
});
