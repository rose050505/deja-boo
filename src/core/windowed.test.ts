import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { tokenize } from './tokenize.js';
import { kgramWinnow } from './fingerprint.js';
import { containment, fingerprintLines, isAliveAtHead, matchWindowed, similarity } from './match.js';
import { hauntLevel } from './level.js';
import { DEFAULT_MINER_CONFIG } from './types.js';

const cfg = DEFAULT_MINER_CONFIG;

const word = fc.stringMatching(/^[a-z]{5,9}$/);

/** A block of 10-25 lines; each line has its own identifiers, so one name occurs on few lines. */
const blockArb = fc
  .array(fc.tuple(word, word, word, fc.integer({ min: 0, max: 999 })), { minLength: 10, maxLength: 25 })
  .map(rows => rows.map(([a, b, c, n], i) => `  const ${a}${i} = ${b}${i}(${c}${i}, ${n}, opts.${b});`));

function toTombstone(lines: string[]) {
  return { lines, fingerprint: fingerprintLines(lines, cfg) };
}

describe('tokenize', () => {
  it('splits identifiers, numbers and punctuation', () => {
    expect(tokenize('method=request.method, 42')).toEqual(['method', '=', 'request', '.', 'method', ',', '42']);
  });
  it('property: tokens joined equal the input without whitespace', () => {
    fc.assert(fc.property(fc.string(), s => tokenize(s).join('') === s.replace(/\s+/g, '')));
  });
  it('default k is 5', () => {
    expect(cfg.kgramSize).toBe(5);
    expect(kgramWinnow('a b c d', cfg)).toEqual([]);
  });
});

describe('matchWindowed', () => {
  it('unit: finds the block inside a larger write with its line range', () => {
    const block = ['const a1 = foo(bar, 1);', 'const b2 = baz(qux, 2);', 'const c3 = one(two, 3);', 'return a1 + b2 + c3;', 'done(a1, b2, c3);'];
    const pad = Array.from({ length: 12 }, (_, i) => `let pad${i} = other${i}(${i});`);
    const m = matchWindowed(toTombstone(block), [...pad, ...block, ...pad], cfg);
    expect(m.similarity).toBe(1);
    expect(m.containment).toBe(1);
    expect(m.matchedLines).toEqual([13, 17]);
  });

  it('unit: empty inputs score 0', () => {
    expect(matchWindowed(toTombstone(['a b c d e f g']), [], cfg).similarity).toBe(0);
    expect(matchWindowed({ lines: [], fingerprint: [] }, ['x'], cfg).matchedLines).toEqual([0, 0]);
  });

  it('property: renaming one identifier in a >= 10-line block keeps windowed similarity >= 0.6', () => {
    fc.assert(
      fc.property(blockArb, fc.nat(), (lines, pick) => {
        const m = /const (\w+) =/.exec(lines[pick % lines.length] as string);
        const name = (m as RegExpExecArray)[1] as string;
        const renamed = lines.map(l => l.replace(new RegExp(`\\b${name}\\b`, 'g'), 'renamedVar'));
        return matchWindowed(toTombstone(lines), renamed, cfg).similarity >= 0.6;
      }),
      { numRuns: 200 },
    );
  });

  it('property: embedding the block in unrelated lines never lowers the score (minus 0.05)', () => {
    fc.assert(
      fc.property(blockArb, blockArb, fc.nat(), (lines, other, at) => {
        const rewritten = lines.map(l => l.replace(/opts/g, 'options'));
        const alone = matchWindowed(toTombstone(lines), rewritten, cfg).similarity;
        const pos = at % (other.length + 1);
        const embedded = [...other.slice(0, pos), ...rewritten, ...other.slice(pos)];
        return matchWindowed(toTombstone(lines), embedded, cfg).similarity >= alone - 0.05;
      }),
      { numRuns: 100 },
    );
  });

  it('property: similarity and containment stay in [0, 1], range is inside the candidate', () => {
    fc.assert(
      fc.property(blockArb, blockArb, (a, b) => {
        const m = matchWindowed(toTombstone(a), b, cfg);
        const [s, e] = m.matchedLines;
        return m.similarity >= 0 && m.similarity <= 1 && m.containment >= 0 && m.containment <= 1 &&
          (m.similarity === 0 || (s >= 1 && e <= b.length && s <= e));
      }),
    );
  });
});

describe('aliveAtHead', () => {
  it('property: a tombstone whose lines appear verbatim in HEAD is always alive', () => {
    fc.assert(
      fc.property(blockArb, blockArb, blockArb, (block, before, after) => {
        const t = toTombstone(block);
        const head = new Set(fingerprintLines([...before, ...block, ...after], cfg));
        return isAliveAtHead(t.fingerprint, head);
      }),
      { numRuns: 200 },
    );
  });
  it('unit: 80% boundary and empty fingerprint', () => {
    expect(isAliveAtHead([1, 2, 3, 4, 5], new Set([1, 2, 3, 4]))).toBe(true);
    expect(isAliveAtHead([1, 2, 3, 4, 5], new Set([1, 2, 3]))).toBe(false);
    expect(isAliveAtHead([], new Set([1]))).toBe(false);
  });
  it('property: containment(a, a) is 1 and similarity is symmetric', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat(50)), fc.uniqueArray(fc.nat(50)), (x, y) => {
        const a = x.sort((p, q) => p - q), b = y.sort((p, q) => p - q);
        return (a.length === 0 || containment(a, a) === 1) && similarity(a, b) === similarity(b, a);
      }),
    );
  });
});

describe('hauntLevel', () => {
  const plain = { causeOfDeath: 'remove cache', links: [] };
  it('warns from 0.5, caps at warn without evidence, blocks from 0.7 with evidence', () => {
    expect(hauntLevel(plain, 0.49)).toBe('none');
    expect(hauntLevel(plain, 0.5)).toBe('warn');
    expect(hauntLevel(plain, 0.95)).toBe('warn');
    expect(hauntLevel({ ...plain, causeOfDeath: 'Revert "x"' }, 0.7)).toBe('block');
    expect(hauntLevel({ ...plain, links: [{ type: 'pr', ref: '#4' }] }, 0.7)).toBe('block');
    expect(hauntLevel({ ...plain, links: [{ type: 'pr', ref: '#4' }] }, 0.69)).toBe('warn');
  });
  it('property: a non-Revert tombstone alive at HEAD is always none', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.string(), (sim, why) =>
      hauntLevel({ ...plain, causeOfDeath: `fix ${why}`, aliveAtHead: true, links: [{ type: 'pr', ref: '#4' }] }, sim) === 'none'));
  });
  it('property: an aliveAtHead Revert tombstone at similarity >= 0.7 is block', () => {
    fc.assert(fc.property(fc.double({ min: 0.7, max: 1, noNaN: true }), fc.constantFrom('Revert "x"', 'revert x', 'REVERT: y'), (s, cause) =>
      hauntLevel({ ...plain, causeOfDeath: cause, aliveAtHead: true }, s) === 'block'));
  });
  it('unit: an aliveAtHead Revert tombstone below 0.5 stays none', () => {
    expect(hauntLevel({ ...plain, causeOfDeath: 'Revert "x"', aliveAtHead: true }, 0.49)).toBe('none');
  });
});
