import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import type { RevivalRecord, Tombstone } from '../core/types.js';
import { NEXT_STEP, NO_COMEBACKS, newestComebacks, summaryLines, MAX_COMEBACKS, firstCauseLine } from './comebacks.js';
import { runIndexCommand } from './index-command.js';

function rev(commit: string, date: string, over: Partial<RevivalRecord> = {}): RevivalRecord {
  return { commit, date, author: 'a@b.c', subject: 's', similarity: 0.9, isRevert: false, isMergeArtifact: false, ...over };
}
function tomb(id: string, revivals: RevivalRecord[], over: Partial<Tombstone> = {}): Tombstone {
  return {
    id, fingerprint: [1], lines: ['x'], path: `src/${id}.ts`, language: 'typescript', buriedAt: '2020-09-01T10:00:00+00:00', buriedAtTimestamp: 1598954400,
    commit: 'c'.repeat(40), author: 'a@b.c', causeOfDeath: 'Revert "Add python 3.9 to CI."\n\nbody', links: [], revivals, deaths: [], ...over,
  };
}

describe('newestComebacks', () => {
  it('lists newest first, at most 5, one per patch, without merge artifacts', () => {
    const ts = [
      tomb('a', [rev('1'.repeat(40), '2021-01-01T00:00:00Z'), rev('2'.repeat(40), '2022-01-01T00:00:00Z')]),
      tomb('b', [rev('3'.repeat(40), '2023-01-01T00:00:00Z', { patchId: 'p' })]),
      tomb('c', [rev('4'.repeat(40), '2023-01-01T00:00:00Z', { patchId: 'p', similarity: 0.5 }), rev('5'.repeat(40), '2024-01-01T00:00:00Z', { isMergeArtifact: true })]),
      tomb('d', [1, 2, 3, 4, 5, 6].map(n => rev(String(n + 5).repeat(40), `2019-0${n}-01T00:00:00Z`))),
    ];
    const list = newestComebacks(ts);
    expect(list).toHaveLength(MAX_COMEBACKS);
    const dates = list.map(c => c.revival.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(list.filter(c => c.revival.patchId === 'p')).toHaveLength(1);
    expect(list.some(c => c.revival.isMergeArtifact)).toBe(false);
    expect(list[0]!.tombstone.id).toBe('b'); // the closer match represents a shared patch
  });

  it('property: sorted newest first, bounded, one per event', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 3000 })), { maxLength: 30 }), pairs => {
      const ts = pairs.map(([k, day], i) => tomb(`t${i}`, [rev(String(k).repeat(40), new Date(Date.UTC(2015, 0, 1 + day)).toISOString(), { patchId: `p${k}` })]));
      const list = newestComebacks(ts);
      const ms = list.map(c => Date.parse(c.revival.date));
      expect(ms).toEqual([...ms].sort((x, y) => y - x));
      expect(new Set(list.map(c => c.revival.patchId)).size).toBe(list.length);
      expect(list.length).toBeLessThanOrEqual(MAX_COMEBACKS);
    }));
  });
});

describe('summaryLines', () => {
  it('prints path, death date, first cause line, reviving commit, date and "via Revert", then the next step', () => {
    const lines = summaryLines([tomb('a', [rev('f'.repeat(40), '2020-10-10T12:00:00Z', { isRevert: true })], { path: '.github/workflows/tests.yaml' })]);
    const text = lines.join('\n');
    expect(text).toContain('.github/workflows/tests.yaml');
    expect(text).toContain('died 2020-09-01: Revert "Add python 3.9 to CI."');
    expect(text).not.toContain('body');
    expect(text).toContain('back 2020-10-10 in ffffffff via Revert');
    expect(lines.at(-1)).toBe(NEXT_STEP);
  });

  it('says so when there is no comeback', () => {
    const lines = summaryLines([tomb('a', [])]);
    expect(lines).toContain(NO_COMEBACKS);
    expect(lines.at(-1)).toBe(NEXT_STEP);
  });

  it('empty cause reads "cause of death unknown"', () => expect(firstCauseLine('  \n')).toBe('cause of death unknown'));
});

describe('index prints the summary after the unchanged counters', () => {
  let dir = '';
  afterEach(() => { vi.restoreAllMocks(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('on a repo with a revert, lists the comeback after "Output"', async () => {
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-sum-'));
    execSync(`bash ${join(import.meta.dirname, '../test-fixtures/haunted-http.sh')} ${join(dir, 'r')}`, { stdio: 'ignore' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runIndexCommand([join(dir, 'r'), '--out', join(dir, 'g.json'), '--grace-days', '0']);
    const out = log.mock.calls.map(c => String(c[0]));
    const at = (p: string): number => out.findIndex(l => l.startsWith(p));
    expect(at('Commits walked   :')).toBe(0);
    expect(at('Output           :')).toBeGreaterThan(at('Alive at HEAD    :'));
    expect(out.slice(at('Output           :'))).toContain(NEXT_STEP);
    expect(out.some(l => l.startsWith('Comebacks found in history') || l === NO_COMEBACKS)).toBe(true);
  });
});
