import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import fc from 'fast-check';
import { hauntLevel, isRevertCause } from './level.js';
import { isRevertSubject } from './revert.js';
import { recordRevival } from '../miner/revival-tracker.js';
import type { ParsedCommit, Tombstone } from './types.js';

describe('isRevertSubject', () => {
  it.each(['Revert "x"', 'revert: x', 'Reverting 3362', 'Reverted', 'reverts the commit', 'REVERT', '  Revert x'])('%j is a Revert', s => {
    expect(isRevertSubject(s)).toBe(true);
  });
  it.each(['Revertible', 'Preserve', ' ', '', 'Do not revert', 'Reversion of x', 'revertx'])('%j is not a Revert', s => {
    expect(isRevertSubject(s)).toBe(false);
  });
  it('looks at the first line only', () => {
    expect(isRevertSubject('fix things\nRevert "x"')).toBe(false);
    expect(isRevertSubject('Revert "x"\nbody')).toBe(true);
  });
});

const subjectArb = fc.oneof(
  fc.string(),
  fc.tuple(fc.constantFrom('Revert', 'revert', 'REVERTING', 'Reverts', 'reverted', 'Revertible', 'Reverting', 'Reversion'), fc.string()).map(([a, b]) => a + b),
  fc.tuple(fc.constantFrom('Revert', 'reverting', 'Reverted'), fc.constantFrom(' ', ':', '\n', '"'), fc.string()).map(([a, b, c]) => a + b + c),
);

function tombstone(cause: string): Tombstone {
  return { id: 'i', fingerprint: [], lines: [], path: 'a', language: 'ts', buriedAt: '', buriedAtTimestamp: 0, commit: 'c', author: 'a', causeOfDeath: cause, links: [], revivals: [], deaths: [] };
}

describe('one Revert predicate', () => {
  it('property: isRevertCause, hauntLevel evidence and revival-tracker agree with isRevertSubject', () => {
    fc.assert(
      fc.property(subjectArb, subject => {
        const expected = isRevertSubject(subject);
        expect(isRevertCause(subject)).toBe(expected);
        // evidence: at similarity 1 a tombstone with no link blocks exactly when the cause is a Revert
        expect(hauntLevel({ aliveAtHead: false, causeOfDeath: subject, links: [] }, 1) === 'block').toBe(expected);
        // alive at HEAD: watched exactly when the cause is a Revert
        expect(hauntLevel({ aliveAtHead: true, causeOfDeath: subject, links: [] }, 1) !== 'none').toBe(expected);
        const t = tombstone('x');
        const meta: ParsedCommit['meta'] = { hash: 'h', authorEmail: 'a@b', subject, body: '', authorDate: '', committerTimestamp: 5 };
        recordRevival(t, meta, 0.9);
        expect(t.revivals[0]?.isRevert).toBe(expected);
      }),
    );
  });

  it('source scan: no other revert regex or startsWith("Revert") in src/ or web/', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'public' || name === 'dist') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mjs)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'web'));
    const offenders = files
      .filter(f => relative(root, f) !== 'src/core/revert.ts')
      .filter(f => /\/\^?\(?(?:\?:)?(?:\\s\*)?revert(?:\\b|\(|\/)|startsWith\(\s*['"`]revert|new RegExp\([^)]*revert/i.test(readFileSync(f, 'utf8')))
      .map(f => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
