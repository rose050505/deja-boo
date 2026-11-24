import { describe, it, expect } from 'vitest';
import { computeStats } from './stats.js';
import type { Tombstone, RevivalRecord } from '../core/types.js';

function makeTombstone(
  buriedAt: string,
  revivals: Array<{ date: string; isRevert?: boolean; isMergeArtifact?: boolean }> = [],
): Tombstone {
  return {
    id: 'abc',
    fingerprint: [1, 2, 3],
    lines: ['x'],
    path: 'src/x.ts',
    language: 'typescript',
    buriedAt,
    buriedAtTimestamp: Math.floor(new Date(buriedAt).getTime() / 1000),
    commit: 'a'.repeat(40),
    author: 'dev@example.com',
    causeOfDeath: 'removed caching',
    links: [],
    revivals: revivals.map(
      (r, i): RevivalRecord => ({
        commit: String(i).padStart(40, 'b'),
        date: r.date,
        author: 'dev@example.com',
        subject: r.isRevert ? 'Revert "remove caching"' : 'add caching back',
        similarity: 1.0,
        isRevert: r.isRevert ?? false,
        isMergeArtifact: r.isMergeArtifact ?? false,
      }),
    ),
    deaths: [],
  };
}

describe('computeStats', () => {
  it('counts one revival per event: the same patch reviving two tombstones, or a cherry-pick of it, counts once with the smaller gap', () => {
    const a = makeTombstone('2024-01-01T00:00:00Z', [{ date: '2024-01-21T00:00:00Z' }]);
    const b = { ...makeTombstone('2024-01-01T00:00:00Z', [{ date: '2024-01-11T00:00:00Z' }]), id: 'def' };
    a.revivals[0]!.patchId = 'p1';
    b.revivals[0]!.patchId = 'p1';
    b.revivals[0]!.commit = 'c'.repeat(40);
    const stats = computeStats([a, b], 10);
    expect(stats.revivals).toBe(1);
    expect(stats.medianRevivalGapDays).toBe(10);
    b.revivals[0]!.patchId = 'p2';
    expect(computeStats([a, b], 10).revivals).toBe(2);
  });

  it('no tombstones → all counts zero, medianRevivalGapDays null', () => {
    const stats = computeStats([], 10);
    expect(stats).toEqual({
      commits: 10,
      tombstones: 0,
      revivals: 0,
      revivalsViaRevert: 0,
      mergeArtifactRevivals: 0,
      aliveAtHead: 0,
      aliveAtHeadReverts: 0,
      medianRevivalGapDays: null,
    });
  });

  it('one tombstone, no revivals → revivals: 0, medianRevivalGapDays null', () => {
    const stats = computeStats([makeTombstone('2024-01-01T00:00:00Z')], 5);
    expect(stats.revivals).toBe(0);
    expect(stats.medianRevivalGapDays).toBeNull();
  });

  it('two revivals with gaps of 5 and 11 days → medianRevivalGapDays: 8', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z', [
      { date: '2024-01-06T00:00:00Z' }, // +5 days
      { date: '2024-01-12T00:00:00Z' }, // +11 days
    ]);
    const stats = computeStats([t], 20);
    expect(stats.revivals).toBe(2);
    expect(stats.medianRevivalGapDays).toBe(8); // Math.round((5+11)/2)
  });

  it('revivalsViaRevert counts only isRevert: true entries', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z', [
      { date: '2024-01-10T00:00:00Z', isRevert: true },
      { date: '2024-01-20T00:00:00Z', isRevert: false },
      { date: '2024-01-30T00:00:00Z', isRevert: true },
    ]);
    const stats = computeStats([t], 50);
    expect(stats.revivals).toBe(3);
    expect(stats.revivalsViaRevert).toBe(2);
  });

  it('odd number of gaps uses middle value', () => {
    // gaps: 3, 7, 15 → sorted [3,7,15] → median = 7
    const t = makeTombstone('2024-01-01T00:00:00Z', [
      { date: '2024-01-04T00:00:00Z' }, // +3
      { date: '2024-01-08T00:00:00Z' }, // +7
      { date: '2024-01-16T00:00:00Z' }, // +15
    ]);
    const stats = computeStats([t], 100);
    expect(stats.medianRevivalGapDays).toBe(7);
  });

  it('tombstones count matches array length', () => {
    const tombstones = [
      makeTombstone('2024-01-01T00:00:00Z'),
      makeTombstone('2024-02-01T00:00:00Z'),
      makeTombstone('2024-03-01T00:00:00Z'),
    ];
    const stats = computeStats(tombstones, 42);
    expect(stats.tombstones).toBe(3);
    expect(stats.commits).toBe(42);
  });

  it('merge-artifact revivals are excluded by default and counted separately', () => {
    const t = makeTombstone('2024-01-01T00:00:00Z', [
      { date: '2024-01-10T00:00:00Z' },
      { date: '2024-01-20T00:00:00Z', isMergeArtifact: true },
    ]);
    const stats = computeStats([t], 5);
    expect(stats.revivals).toBe(1);
    expect(stats.mergeArtifactRevivals).toBe(1);
    expect(computeStats([t], 5, { includeMergeArtifacts: true }).revivals).toBe(2);
  });

  it('aliveAtHead tombstones are counted separately but stay in tombstones', () => {
    const t = { ...makeTombstone('2024-01-01T00:00:00Z'), aliveAtHead: true };
    const stats = computeStats([t, makeTombstone('2024-02-01T00:00:00Z')], 5);
    expect(stats.tombstones).toBe(2);
    expect(stats.aliveAtHead).toBe(1);
  });
});
