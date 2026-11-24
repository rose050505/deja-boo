import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runIndex, runIndexWithStats } from './index.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { MinerConfig } from '../core/types.js';

// A block large enough to pass minBlockLines=4 and produce a non-empty fingerprint.
const BLOCK_A = [
  'function fetchUser(id: string) {',
  '  const url = `/api/users/${id}`;',
  '  return fetch(url).then(r => r.json());',
  '}',
].join('\n');

const BLOCK_B = [
  'function computeHash(input: string) {',
  '  let h = 0;',
  '  for (const c of input) h = (h * 31 + c.charCodeAt(0)) >>> 0;',
  '  return h;',
  '}',
].join('\n');

const CFG: MinerConfig = {
  ...DEFAULT_MINER_CONFIG,
  kgramSize: 3,
  windowSize: 2,
  minBlockLines: 4,
  graceDays: 7,
};

function mkRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deja-boo-idx-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function commit(repo: string, file: string, content: string, message: string): string {
  writeFileSync(join(repo, file), content);
  execSync(`git add "${file}"`, { cwd: repo, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd: repo, stdio: 'ignore' });
  return execSync('git rev-parse HEAD', { cwd: repo }).toString().trim();
}

function commitDate(repo: string, daysFromNow: number): string {
  // Returns an ISO date offset from a fixed base so tests are deterministic.
  const base = new Date('2024-01-01T00:00:00Z');
  base.setDate(base.getDate() + daysFromNow);
  return base.toISOString();
}

// Commit with an explicit author date so we can control grace window math.
function timedCommit(
  repo: string,
  file: string,
  content: string,
  message: string,
  date: string,
): void {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  execSync(`git add "${file}"`, { cwd: repo, stdio: 'ignore' });
  execSync(
    `GIT_AUTHOR_DATE="${date}" GIT_COMMITTER_DATE="${date}" git commit -m "${message}"`,
    { cwd: repo, stdio: 'ignore', shell: '/bin/bash' },
  );
}

let repo: string;
beforeEach(() => { repo = mkRepo(); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('runIndex – integration tests', () => {
  it('a block deleted in commit A appears as a tombstone', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK_A + '\n', 'add fetchUser', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove fetchUser', '2024-01-15T00:00:00Z');

    const graveyard = await runIndex(repo, CFG);
    expect(graveyard.tombstones.length).toBeGreaterThanOrEqual(1);
    const hasIt = graveyard.tombstones.some(t =>
      t.lines.some(l => l.includes('fetchUser')),
    );
    expect(hasIt).toBe(true);
  });

  it('a block deleted and re-added in the same commit does not appear (move detection)', async () => {
    timedCommit(repo, 'src/a.ts', BLOCK_A + '\n', 'add fetchUser in a', '2024-01-01T00:00:00Z');
    // Move it: delete from a.ts, add to b.ts in one commit.
    writeFileSync(join(repo, 'src/a.ts'), '// empty\n');
    writeFileSync(join(repo, 'src/b.ts'), BLOCK_A + '\n');
    execSync('git add src/a.ts src/b.ts', { cwd: repo, stdio: 'ignore' });
    execSync('GIT_AUTHOR_DATE="2024-01-10T00:00:00Z" GIT_COMMITTER_DATE="2024-01-10T00:00:00Z" git commit -m "move fetchUser to b.ts"',
      { cwd: repo, stdio: 'ignore', shell: '/bin/bash' });

    const graveyard = await runIndex(repo, CFG);
    const hasIt = graveyard.tombstones.some(t =>
      t.lines.some(l => l.includes('fetchUser')),
    );
    expect(hasIt).toBe(false);
  });

  it('a block deleted and re-added within 7 days does not appear (grace period)', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK_A + '\n', 'add fetchUser', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// removed\n', 'delete fetchUser', '2024-01-05T00:00:00Z');
    timedCommit(repo, 'src/x.ts', BLOCK_A + '\n', 'restore fetchUser', '2024-01-10T00:00:00Z');

    const graveyard = await runIndex(repo, CFG);
    const hasIt = graveyard.tombstones.some(t =>
      t.lines.some(l => l.includes('fetchUser')),
    );
    expect(hasIt).toBe(false);
  });

  it('a block deleted and re-added after 8+ days appears with one revival record', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK_A + '\n', 'add fetchUser', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// removed\n', 'delete fetchUser', '2024-01-05T00:00:00Z');
    timedCommit(repo, 'src/x.ts', BLOCK_A + '\n', 'restore fetchUser', '2024-01-20T00:00:00Z');

    const graveyard = await runIndex(repo, CFG);
    const tombstone = graveyard.tombstones.find(t =>
      t.lines.some(l => l.includes('fetchUser')),
    );
    expect(tombstone).toBeDefined();
    expect(tombstone!.revivals.length).toBeGreaterThanOrEqual(1);
  });

  it('re-indexing the same repo produces identical JSON output (determinism)', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK_A + '\n', 'add fetchUser', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove fetchUser', '2024-01-15T00:00:00Z');

    const { graveyard: g1 } = await runIndexWithStats(repo, CFG);
    const { graveyard: g2 } = await runIndexWithStats(repo, CFG);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });

  it('a block in node_modules/ is not indexed', async () => {
    mkdirSync(join(repo, 'node_modules'), { recursive: true });
    timedCommit(
      repo,
      'node_modules/lib.ts',
      BLOCK_B + '\n',
      'add lib (should be skipped)',
      '2024-01-01T00:00:00Z',
    );
    timedCommit(
      repo,
      'node_modules/lib.ts',
      '// empty\n',
      'delete lib',
      '2024-01-15T00:00:00Z',
    );

    const graveyard = await runIndex(repo, {
      ...CFG,
      skipPatterns: ['node_modules/**'],
    });
    const hasIt = graveyard.tombstones.some(t => t.path.includes('node_modules'));
    expect(hasIt).toBe(false);
  });

  it('a block too short (< minBlockLines) is not indexed', async () => {
    // Only 2 lines — below minBlockLines=4.
    const tiny = 'const x = 1;\nconst y = 2;\n';
    timedCommit(repo, 'src/x.ts', tiny, 'add tiny', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove tiny', '2024-01-15T00:00:00Z');

    const graveyard = await runIndex(repo, CFG);
    expect(graveyard.tombstones).toHaveLength(0);
  });
});

// ─── Post-review fixes 4: deaths that were not deaths, revivals that were not revivals ──────────

describe('runIndex – post-review fixes 4', () => {
  const day = (n: number): string => commitDate(repo, n);
  const wrapped = BLOCK_B.split('\n').map(l => l.trim()).join(' '); // the whole function re-wrapped onto one line

  it('a block re-wrapped onto one line (replacement shorter than minBlockLines) is not a tombstone', async () => {
    timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add', day(0));
    timedCommit(repo, 'src/x.ts', `${wrapped}\n`, 'reformat', day(10));
    const g = await runIndex(repo, CFG);
    expect(g.tombstones).toHaveLength(0);
  });

  it('a block moved into another file inside a larger block is not a tombstone', async () => {
    timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add', day(0));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/y.ts'), `export const a = 1;\nexport const b = makeThing(a, 2);\n${BLOCK_B}\nexport default computeHash;\n`);
    execSync('git add src/y.ts', { cwd: repo, stdio: 'ignore' });
    timedCommit(repo, 'src/x.ts', '// moved\n', 'move to y', day(10));
    const g = await runIndex(repo, CFG);
    expect(g.tombstones).toHaveLength(0);
  });

  it('code that comes back inside a larger added block is a revival (containment in a window, not whole-block Jaccard)', async () => {
    timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add', day(0));
    timedCommit(repo, 'src/x.ts', '// gone\n', 'remove computeHash', day(1));
    const bigger = ['export const seed = 17;', 'export function salt(x: number) { return x ^ seed; }', BLOCK_B, 'export function pepper(y: number) { return salt(y) * 3; }', 'export const ready = true;'].join('\n');
    timedCommit(repo, 'src/x.ts', `${bigger}\n`, 'Restoring computeHash', day(30));
    const g = await runIndex(repo, CFG);
    expect(g.tombstones).toHaveLength(1);
    expect(g.tombstones[0]!.revivals.map(r => r.subject)).toEqual(['Restoring computeHash']);
  });

  it('a "revival" while the code is still elsewhere in the tree is not recorded (it never died)', async () => {
    timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add x', day(0));
    timedCommit(repo, 'src/keep.ts', `${BLOCK_B}\n`, 'copy to keep', day(1));
    timedCommit(repo, 'src/x.ts', '// gone\n', 'remove from x', day(2));
    timedCommit(repo, 'src/z.ts', `${BLOCK_B}\n`, 'copy to z', day(40));
    const { graveyard, stats } = await runIndexWithStats(repo, CFG);
    expect(graveyard.tombstones.flatMap(t => t.revivals)).toEqual([]);
    expect(stats.revivalsNotDead).toBe(1);
  });

  describe('the parent-tree check is relative to the revival\'s own similarity (post-review fixes 5)', () => {
    const variant = BLOCK_B.replace('31', '37');
    const far = BLOCK_B.split('\n').slice(0, 2).join('\n') + '\n  return 0;\n}';

    it('code that stays in the tree at the same 0.9-0.96 share the revival has is not a revival', async () => {
      timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add x', day(0));
      timedCommit(repo, 'src/keep.ts', `${variant}\n`, 'variant elsewhere', day(1));
      timedCommit(repo, 'src/x.ts', '// gone\n', 'remove from x', day(2));
      timedCommit(repo, 'src/z.ts', `${variant}\n`, 'variant again', day(40));
      const { graveyard, stats } = await runIndexWithStats(repo, { ...CFG, moveThreshold: 0.6 });
      const sim = graveyard.tombstones.flatMap(t => t.revivals).map(r => r.similarity);
      expect(sim).toEqual([]);
      expect(stats.revivalsNotDead).toBe(1);
    });

    it('code that comes back in full while only a lesser share stayed in the tree is a revival', async () => {
      timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add x', day(0));
      timedCommit(repo, 'src/keep.ts', `${far}\n`, 'lesser copy elsewhere', day(1));
      timedCommit(repo, 'src/x.ts', '// gone\n', 'remove from x', day(2));
      timedCommit(repo, 'src/z.ts', `${BLOCK_B}\n`, 'full copy back', day(40));
      const { graveyard, stats } = await runIndexWithStats(repo, { ...CFG, moveThreshold: 0.6 });
      expect(graveyard.tombstones.flatMap(t => t.revivals.map(r => r.subject))).toEqual(['full copy back']);
      expect(stats.revivalsNotDead).toBe(0);
    });

    it('a margin makes the rejection looser: the same lesser share is rejected when the margin covers the gap', async () => {
      timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add x', day(0));
      timedCommit(repo, 'src/keep.ts', `${far}\n`, 'lesser copy elsewhere', day(1));
      timedCommit(repo, 'src/x.ts', '// gone\n', 'remove from x', day(2));
      timedCommit(repo, 'src/z.ts', `${BLOCK_B}\n`, 'full copy back', day(40));
      const { graveyard } = await runIndexWithStats(repo, { ...CFG, moveThreshold: 0.6, aliveMargin: 1 });
      expect(graveyard.tombstones.flatMap(t => t.revivals)).toEqual([]);
    });
  });

  it('a re-add on a branch that does not contain the death commit is not a revival', async () => {
    timedCommit(repo, 'src/x.ts', `${BLOCK_B}\n`, 'add', day(0));
    const main = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo }).toString().trim();
    execSync('git branch side', { cwd: repo, stdio: 'ignore' });
    timedCommit(repo, 'src/x.ts', '// gone\n', 'remove on main', day(1));
    execSync('git checkout -q side', { cwd: repo, stdio: 'ignore' });
    timedCommit(repo, 'src/w.ts', `${BLOCK_B}\n`, 'add on side', day(30));
    execSync(`git checkout -q ${main}`, { cwd: repo, stdio: 'ignore' });
    const { graveyard, stats } = await runIndexWithStats(repo, { ...CFG });
    // The side branch is not merged, so `git log` does not walk it; merge it without resolving anything new.
    expect(graveyard.tombstones.flatMap(t => t.revivals)).toEqual([]);
    execSync(`GIT_AUTHOR_DATE="${day(31)}" GIT_COMMITTER_DATE="${day(31)}" git merge -q --no-edit side`, { cwd: repo, stdio: 'ignore', shell: '/bin/bash' });
    const merged = await runIndexWithStats(repo, CFG);
    expect(merged.graveyard.tombstones.flatMap(t => t.revivals)).toEqual([]);
    expect(merged.stats.revivalsNotAncestor).toBe(1);
    expect(stats.revivalsNotAncestor).toBe(0);
  });
});
