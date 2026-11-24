import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { changedRuns, gramsByFile, patchId, unionGrams } from './commit-grams.js';
import { kgramSetOfLines } from '../core/match.js';
import { DEFAULT_MINER_CONFIG, type Hunk, type ParsedCommit } from '../core/types.js';

const line = fc.stringMatching(/^ {0,4}[a-z]{3,8} = [a-z]{3,8}\([0-9]{1,3}\);$/);
const hunkArb = fc.record({
  filePath: fc.constantFrom('a.ts', 'b.py', 'c.yml'),
  oldStart: fc.nat(500),
  newStart: fc.nat(500),
  deletedLines: fc.array(fc.oneof(line, fc.constant('')), { maxLength: 6 }),
  addedLines: fc.array(fc.oneof(line, fc.constant('')), { maxLength: 6 }),
});
const commitArb = (hash: string): fc.Arbitrary<ParsedCommit> => fc.array(hunkArb, { maxLength: 5 }).map((hunks: Hunk[]) => ({
  meta: { hash, authorEmail: 'a@b', subject: 's', body: '', authorDate: '2026-01-01T00:00:00Z', committerTimestamp: 0 },
  hunks,
}));

describe('commit-grams', () => {
  it('property: changedRuns keeps every non-blank changed line and no blank one', () => {
    fc.assert(fc.property(commitArb('a'), c => {
      for (const side of ['added', 'deleted'] as const) {
        const runs = changedRuns(c, side);
        const want = c.hunks.flatMap(h => (side === 'added' ? h.addedLines : h.deletedLines).filter(l => l.trim() !== ''));
        expect(runs.flatMap(r => r.lines)).toEqual(want);
        for (const r of runs) expect(r.lines.length).toBeGreaterThan(0);
      }
    }));
  });
  it('property: the union of gramsByFile equals unionGrams and contains each run\'s k-grams', () => {
    fc.assert(fc.property(commitArb('a'), c => {
      const runs = changedRuns(c, 'added');
      const all = new Set<number>();
      for (const s of gramsByFile(runs, DEFAULT_MINER_CONFIG).values()) for (const h of s) all.add(h);
      expect([...unionGrams(runs, DEFAULT_MINER_CONFIG)].sort()).toEqual([...all].sort());
      for (const r of runs) for (const h of kgramSetOfLines(r.lines, { ...DEFAULT_MINER_CONFIG, language: r.filePath.endsWith('.py') ? 'python' : r.filePath.endsWith('.yml') ? 'yaml' : 'typescript' })) expect(all.has(h)).toBe(true);
    }));
  });
  it('property: patchId ignores hash, line numbers and whitespace, and changes with the content', () => {
    fc.assert(fc.property(commitArb('a'), fc.nat(100), (c, shift) => {
      const moved: ParsedCommit = {
        meta: { ...c.meta, hash: 'b', subject: 'cherry-pick' },
        hunks: c.hunks.map(h => ({ ...h, oldStart: h.oldStart + shift, newStart: h.newStart + shift, addedLines: h.addedLines.map(l => `\t${l}  `) })),
      };
      expect(patchId(moved)).toBe(patchId(c));
      const changed: ParsedCommit = { ...c, hunks: [...c.hunks, { filePath: 'z.ts', oldStart: 1, newStart: 1, deletedLines: [], addedLines: ['extra();'] }] };
      expect(patchId(changed)).not.toBe(patchId(c));
    }));
  });
});
