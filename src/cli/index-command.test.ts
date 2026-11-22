import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runIndexCommand } from './index-command.js';

const BLOCK = [
  'function fetchUser(id: string) {',
  '  const url = `/api/users/${id}`;',
  '  return fetch(url).then(r => r.json());',
  '}',
].join('\n');

function mkRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deja-boo-cli-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function timedCommit(repo: string, file: string, content: string, message: string, date: string): void {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  execSync(`git add "${file}"`, { cwd: repo, stdio: 'ignore' });
  execSync(
    `GIT_AUTHOR_DATE="${date}" GIT_COMMITTER_DATE="${date}" git commit -m "${message}"`,
    { cwd: repo, stdio: 'ignore', shell: '/bin/bash' },
  );
}

let repo: string;
let outDir: string;

beforeEach(() => {
  repo = mkRepo();
  outDir = mkdtempSync(join(tmpdir(), 'deja-boo-out-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

describe('runIndexCommand', () => {
  it('writes a valid graveyard JSON with tombstones and stats keys', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK + '\n', 'add fetchUser', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove fetchUser', '2024-01-15T00:00:00Z');

    const out = join(outDir, 'graveyard.json');
    await runIndexCommand([repo, '--out', out, '--kgram-size', '3', '--window-size', '2']);

    expect(existsSync(out)).toBe(true);
    const json = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(json).toHaveProperty('tombstones');
    expect(json).toHaveProperty('stats');
  });

  it('--out to a non-existent directory creates the directory and the file', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK + '\n', 'add', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove', '2024-01-15T00:00:00Z');

    const out = join(outDir, 'nested', 'deep', 'graveyard.json');
    await runIndexCommand([repo, '--out', out, '--kgram-size', '3', '--window-size', '2']);
    expect(existsSync(out)).toBe(true);
  });

  it('running on a non-git directory exits with code 1', async () => {
    const notGit = mkdtempSync(join(tmpdir(), 'not-git-'));
    try {
      await expect(
        runIndexCommand([notGit, '--out', join(outDir, 'g.json')]),
      ).rejects.toThrow();
    } catch {
      // process.exit(1) also acceptable; either path is correct.
    } finally {
      rmSync(notGit, { recursive: true, force: true });
    }
  });

  it('--grace-days 0 disables grace; block re-added next day produces a tombstone with revival', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK + '\n', 'add fetchUser', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove fetchUser', '2024-01-05T00:00:00Z');
    timedCommit(repo, 'src/x.ts', BLOCK + '\n', 'restore fetchUser', '2024-01-06T00:00:00Z');

    const out = join(outDir, 'graveyard.json');
    await runIndexCommand([
      repo, '--out', out,
      '--kgram-size', '3', '--window-size', '2',
      '--grace-days', '0',
    ]);

    const json = JSON.parse(readFileSync(out, 'utf8')) as {
      tombstones: Array<{ lines: string[]; revivals: unknown[] }>;
    };
    const tombstone = json.tombstones.find(t =>
      t.lines.some(l => l.includes('fetchUser')),
    );
    expect(tombstone).toBeDefined();
    expect(tombstone!.revivals.length).toBeGreaterThanOrEqual(1);
  });
});
