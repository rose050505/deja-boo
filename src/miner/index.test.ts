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
