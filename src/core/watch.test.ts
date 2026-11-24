import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { acknowledgedIds, addedLineNumbers, distinctRecovery, findRevenants, matchWindowedIndexed } from './watch.js';
import type { WindowIndex } from './watch.js';
import { fingerprintLines, matchWindowed } from './match.js';
import { hauntLevel } from './level.js';
import type { Graveyard, Thresholds, Tombstone } from './types.js';

const word = fc.stringMatching(/^[a-z]{5,9}$/);
const blockArb = fc
  .array(fc.tuple(word, word, word, fc.integer({ min: 0, max: 999 })), { minLength: 8, maxLength: 16 })
  .map(rows => rows.map(([a, b, c, n], i) => `  const ${a}${i} = ${b}${i}(${c}${i}, ${n}, opts.${b});`));
const padArb = fc.array(word, { minLength: 3, maxLength: 12 }).map(ws => ws.map((w, i) => `let pad_${w}_${i} = zzz${i}(${i});`));

function stone(id: string, lines: string[], over: Partial<Tombstone> = {}): Tombstone {
  return {
    id, fingerprint: fingerprintLines(lines), lines, path: 'a.ts', language: 'typescript',
    buriedAt: '2026-03-02T00:00:00Z', buriedAtTimestamp: 0, commit: 'c'.repeat(40), author: 'x@y',
    causeOfDeath: 'Revert "x"', links: [], revivals: [], deaths: [], ...over,
  };
}
const yard = (...tombstones: Tombstone[]): Graveyard => ({ tombstones, stats: {} as Graveyard['stats'] });
const T: Thresholds = { warn: 0.5, block: 0.7 };

describe('addedLineNumbers', () => {
  it('unit: insert, replace, whitespace-only, empty before', () => {
    expect([...addedLineNumbers('a\nb\nc', 'a\nX\nb\nc')]).toEqual([2]);
    expect([...addedLineNumbers('a\nb\nc', 'a\nY\nc')]).toEqual([2]);
    expect([...addedLineNumbers('a\n  b\nc', 'a\n\tb  \nc')]).toEqual([]);
    expect([...addedLineNumbers('', 'a\nb')]).toEqual([1, 2]);
    expect([...addedLineNumbers('a\nb', '')]).toEqual([]);
  });
  it('unit: a repeated line is added where the diff says, not where it merely exists elsewhere', () => {
    const before = ['x = 1', 'y = 2', 'z = 3'].join('\n');
    const after = ['p()', 'x = 1', 'y = 2', 'z = 3', 'x = 1', 'y = 2'].join('\n');
    expect([...addedLineNumbers(before, after)].sort()).toEqual([1, 5, 6]);
  });
  it('property: addedLineNumbers(x, x) is empty', () => {
    fc.assert(fc.property(fc.array(fc.string(), { maxLength: 30 }), ls => addedLineNumbers(ls.join('\n'), ls.join('\n')).size === 0));
  });
  it('property: inserting k unique non-blank lines marks exactly those k lines', () => {
    fc.assert(fc.property(
      fc.array(fc.stringMatching(/^[a-c ]{0,4}$/), { maxLength: 25 }).filter(b => !(b.length === 1 && b[0] === '')), // [''] and [] both join to the empty file
      fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
      (base, slots) => {
        const out = [...base];
        const expected: number[] = [];
        slots.forEach((s, i) => out.splice(s % (out.length + 1), 0, `INSERTED_${i}`));
        out.forEach((l, i) => { if (l.startsWith('INSERTED_')) expected.push(i + 1); });
        const got = [...addedLineNumbers(base.join('\n'), out.join('\n'))].sort((a, b) => a - b);
        return JSON.stringify(got) === JSON.stringify(expected);
      },
    ), { numRuns: 300 });
  });
  it('property: whitespace-only edits add nothing', () => {
    fc.assert(fc.property(fc.array(word, { minLength: 1, maxLength: 20 }), ws => {
      const before = ws.join('\n');
      const after = ws.map(w => `  ${w}\t`).join('\n');
      return addedLineNumbers(before, after).size === 0;
    }));
  });
});

describe('acknowledgedIds', () => {
  it('property: includes every appended id', () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[0-9a-f]{40}$/), { maxLength: 5 }), fc.string(), (ids, code) => {
      const text = code + ids.map(i => `\n// deja-boo: checked ${i}`).join('');
      const got = acknowledgedIds(text);
      return ids.every(i => got.has(i));
    }));
  });
});

describe('findRevenants', () => {
  it('property: embedding a tombstone scores 1; similarity in [0,1]', () => {
    fc.assert(fc.property(blockArb, padArb, padArb, (block, pre, post) => {
      const hits = findRevenants(yard(stone('a'.repeat(40), block)), [...pre, ...block, ...post], T);
      return hits.length === 1 && hits[0]!.similarity === 1 && hits[0]!.matchedLines[0] === pre.length + 1;
    }), { numRuns: 100 });
  });
  it('property: raising a threshold never adds a hit', () => {
    fc.assert(fc.property(blockArb, padArb, fc.double({ min: 0.05, max: 0.9, noNaN: true }), fc.double({ min: 0, max: 0.1, noNaN: true }), (block, pad, w, dw) => {
      const g = yard(stone('b'.repeat(40), block));
      const cand = [...pad, ...block.slice(1), ...pad];
      const lo = findRevenants(g, cand, { warn: w, block: Math.max(w, 0.7) }).length;
      const hi = findRevenants(g, cand, { warn: Math.min(1, w + dw), block: Math.max(Math.min(1, w + dw), 0.7) + dw / 2 }).length;
      return hi <= lo;
    }), { numRuns: 100 });
  });
  it('property: aliveAtHead non-Revert tombstones are never reported', () => {
    fc.assert(fc.property(blockArb, padArb, (block, pad) => {
      const t = stone('c'.repeat(40), block, { aliveAtHead: true, causeOfDeath: 'drop cache', links: [{ type: 'pr', ref: '1' }] });
      return findRevenants(yard(t), [...pad, ...block], { warn: 0.01, block: 0.01 }).length === 0;
    }));
  });
  it('unit: hits sorted by similarity desc then id asc', () => {
    const block = Array.from({ length: 8 }, (_, i) => `  const v${i} = fn${i}(arg${i}, ${i}, opts.k${i});`);
    const g = yard(stone('f'.repeat(40), block), stone('1'.repeat(40), block));
    expect(findRevenants(g, block, T).map(h => h.tombstone.id[0])).toEqual(['1', 'f']);
  });
  it('unit: a write that raises the score by 0.1 or more fires; one that does not, does not', () => {
    const block = Array.from({ length: 10 }, (_, i) => `  const v${i} = fn${i}(arg${i}, ${i}, opts.k${i});`);
    const g = yard(stone('d'.repeat(40), block));
    const partial = [...block.slice(0, 7), 'other();', 'other2();', 'other3();'];
    expect(findRevenants(g, block, T, partial).length).toBe(1); // score rises toward the buried variant
    expect(findRevenants(g, [...block, 'tail();'], T, block).length).toBe(0); // already there, unchanged
    expect(findRevenants(g, block, T, []).length).toBe(1); // new file
  });
  it('unit: hauntLevel with thresholds', () => {
    const t = { aliveAtHead: false, causeOfDeath: 'x', links: [{ type: 'pr' as const, ref: '1' }] };
    expect(hauntLevel(t, 0.6)).toBe('warn');
    expect(hauntLevel(t, 0.6, { warn: 0.5, block: 0.6 })).toBe('block');
    expect(hauntLevel(t, 0.6, { warn: 0.65, block: 0.9 })).toBe('none');
  });
});

describe('matchWindowedIndexed (exact prefilter)', () => {
  const noisy = fc.array(
    fc.oneof(
      word.map(w => `  call_${w}(${w}, 1);`),
      word.map(w => `// note ${w}`),
      word.map(w => `/* ${w}`),
      word.map(w => `${w} */`),
      fc.constant(''),
      fc.constant('  # comment'),
    ),
    { minLength: 0, maxLength: 40 },
  );
  it('property: equals matchWindowed for tombstones, comment lines and candidates of any size', () => {
    fc.assert(fc.property(noisy, noisy, noisy, (tl, pre, post) => {
      const t = { lines: tl, fingerprint: fingerprintLines(tl) };
      for (const candidate of [[...pre, ...tl, ...post], pre, tl, post]) {
        const cache = new Map<number, WindowIndex>();
        expect(matchWindowedIndexed(t, candidate, cache)).toEqual(matchWindowed(t, candidate));
        expect(matchWindowedIndexed(t, candidate, cache)).toEqual(matchWindowed(t, candidate)); // warm cache
      }
    }), { numRuns: 300 });
  });
});

describe('findRevenants prefilter', () => {
  const lineArb = fc.oneof(
    word.map(w => `  call_${w}(${w}, 1, opts.${w});`),
    word.map(w => `// note ${w}`),
    word.map(w => `/* ${w}`),
    word.map(w => `${w} */`),
    word.map(w => `# ${w}`),
    fc.constant(''),
  );
  const linesArb = fc.array(lineArb, { minLength: 0, maxLength: 40 });
  /** Reference: every tombstone through matchWindowed and hauntLevel, no shortcuts. */
  function naive(g: Graveyard, cand: string[], th: Thresholds): string[] {
    const ids: string[] = [];
    for (const t of g.tombstones) {
      const m = matchWindowed(t, cand);
      if (hauntLevel(t, m.similarity, th) !== 'none') ids.push(t.id + m.matchedLines.join('-') + m.similarity);
    }
    return ids.sort();
  }
  it('property: prefilter on versus off gives equal hits, with and without comment lines', () => {
    fc.assert(fc.property(linesArb, linesArb, linesArb, linesArb, (a, b, pre, post) => {
      const g = yard(stone('1'.repeat(40), a), stone('2'.repeat(40), b), stone('3'.repeat(40), [...a, ...b]));
      for (const cand of [[...pre, ...a, ...post], [...pre, ...b, ...a], pre, [...post, ...b]]) {
        for (const th of [T, { warn: 0.2, block: 0.9 }]) {
          const got = findRevenants(g, cand, th, undefined, { minHashes: 0 }).map(h => h.tombstone.id + h.matchedLines.join('-') + h.similarity).sort();
          expect(got).toEqual(naive(g, cand, th));
        }
      }
    }), { numRuns: 300 });
  });
});

describe('findRevenants with `before` ("this write makes it worse")', () => {
  it('property (a): a candidate equal to the disk text never fires', () => {
    fc.assert(fc.property(blockArb, padArb, padArb, (block, pre, post) => {
      const g = yard(stone('a'.repeat(40), block), stone('b'.repeat(40), block.slice(2)));
      for (const file of [[...pre, ...block, ...post], block, pre]) {
        expect(findRevenants(g, file, { warn: 0.3, block: 0.6 }, file)).toEqual([]);
      }
    }), { numRuns: 100 });
  });
  it('property (b): a tombstone embedded verbatim into a file that lacked it is reported unless alive non-Revert', () => {
    fc.assert(fc.property(blockArb, padArb, padArb, fc.boolean(), fc.boolean(), (block, pre, post, alive, revert) => {
      const t = stone('c'.repeat(40), block, { aliveAtHead: alive, causeOfDeath: revert ? 'Revert "x"' : 'leaked' });
      const before = [...pre, ...post];
      const hits = findRevenants(yard(t), [...pre, ...block, ...post], T, before);
      expect(hits.length).toBe(alive && !revert ? 0 : 1);
    }), { numRuns: 100 });
  });
  it('unit: copying a live line elsewhere does not raise the score, so no hit', () => {
    const block = Array.from({ length: 10 }, (_, i) => `  const v${i} = fn${i}(arg${i}, ${i}, opts.k${i});`);
    const g = yard(stone('e'.repeat(40), block));
    const disk = [...block.slice(0, 7), 'a();', 'b();', 'c();'];
    expect(findRevenants(g, [...disk, 'unrelated();'], T, disk)).toEqual([]);
    expect(findRevenants(g, [...disk, block[0] as string], T, disk)).toEqual([]);
  });
});

describe('distinctRecovery', () => {
  it('property: when after equals before, nothing is recovered, and recovered <= distinct', () => {
    fc.assert(fc.property(blockArb, padArb, blockArb, (block, pad, other) => {
      const t = stone('a'.repeat(40), block);
      const text = [...pad, ...other].join('\n');
      const same = distinctRecovery(t, text, text);
      expect(same.recovered).toBe(0);
      const grown = distinctRecovery(t, text, [...pad, ...block].join('\n'));
      expect(grown.recovered).toBeLessThanOrEqual(grown.distinct);
    }), { numRuns: 100 });
  });
  it('unit: one-line difference from live code (modeled on the requests revert) fires when that line is written back', () => {
    const live = [
      'resp = conn.urlopen(', '  method=request.method,', '  url=url,', '  body=request.body,', '  headers=request.headers,',
      '  redirect=False,', '  assert_same_host=False,', '  preload_content=False,', '  decode_content=False,', '  retries=self.max_retries,',
      '  timeout=timeout,',
      ...Array.from({ length: 12 }, (_, i) => `  option_${i}=settings.value_${i},`),
    ];
    const buried = [...live, '  chunked=chunked,', ')'];
    const g = yard(stone('9'.repeat(40), buried));
    const disk = [...live, ')'];
    const after = [...live, '  chunked=chunked,', ')'];
    const sBefore = matchWindowed(g.tombstones[0] as Tombstone, disk).similarity;
    const sAfter = matchWindowed(g.tombstones[0] as Tombstone, after).similarity;
    expect(sAfter).toBeLessThan(sBefore + 0.1); // the old rule stays silent
    expect(findRevenants(g, after, T, disk).length).toBe(1);
    const r = distinctRecovery(g.tombstones[0] as Tombstone, disk.join('\n'), after.join('\n'));
    expect(r.distinct).toBeGreaterThanOrEqual(1);
    expect(r.recovered / r.distinct).toBeGreaterThanOrEqual(0.5);
    expect(findRevenants(g, [...disk, 'def other(): pass'], T, disk)).toEqual([]); // unrelated write
    expect(findRevenants(g, [...disk, '', ...disk], T, disk)).toEqual([]); // copying the live call elsewhere
  });
});

describe('minHashes (tombstones with few distinct hashes are not watched)', () => {
  const block = ['try:', '  range_type = xrange', 'except NameError:', '  range_type = range'];
  it('unit: a tombstone with fewer than minHashes hashes never fires, however well it matches; minHashes 0 watches it', () => {
    const tiny = stone('1'.repeat(40), block);
    expect(tiny.fingerprint.length).toBeLessThan(4);
    const g = yard(tiny);
    expect(findRevenants(g, block, T)).toEqual([]);
    expect(findRevenants(g, block, T, undefined, { minHashes: tiny.fingerprint.length }).length).toBeGreaterThan(0);
  });
  it('property: raising minHashes never adds a hit, and no hit has fewer hashes than minHashes', () => {
    const lines = fc.array(word.map(w => `  call_${w}(${w}, 1);`), { minLength: 1, maxLength: 12 });
    fc.assert(fc.property(lines, lines, fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 20 }), (a, b, m1, d) => {
      const g = yard(stone('1'.repeat(40), a), stone('2'.repeat(40), b));
      const lo = findRevenants(g, [...a, ...b], T, undefined, { minHashes: m1 });
      const hi = findRevenants(g, [...a, ...b], T, undefined, { minHashes: m1 + d });
      const ids = new Set(lo.map(h => h.tombstone.id));
      for (const h of hi) { expect(ids.has(h.tombstone.id)).toBe(true); expect(h.tombstone.fingerprint.length).toBeGreaterThanOrEqual(m1 + d); }
    }), { numRuns: 200 });
  });
});
