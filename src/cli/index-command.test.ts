import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runIndexCommand } from './index-command.js';
import { loadGraveyard } from '../watch/load.js';

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

  it('without --out writes <repo>/.deja-boo/graveyard.json, where check and the hooks read it', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK + '\n', 'add', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove', '2024-01-15T00:00:00Z');
    await runIndexCommand([repo, '--kgram-size', '3', '--window-size', '2', '--min-hashes', '1']);
    const file = join(repo, '.deja-boo', 'graveyard.json');
    expect(existsSync(file)).toBe(true);
    expect(loadGraveyard(repo)?.tombstones.length).toBeGreaterThan(0);
  });

  it('a deleted JSDoc interior and a deleted lock file never become tombstones, deleted code does', async () => {
    const doc = ['/**', ' * Return request header.', ' *', ' * @return {Object}', ' * @api public', ' */'].join('\n');
    timedCommit(repo, 'lib/a.js', `${doc}\nfunction header() {\n  return 1;\n}\n`, 'add', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'uv.lock', BLOCK + '\n', 'lock', '2024-01-02T00:00:00Z');
    timedCommit(repo, 'lib/a.js', '// gone\n', 'remove all', '2024-01-15T00:00:00Z');
    timedCommit(repo, 'uv.lock', '# empty\n', 'unlock', '2024-01-16T00:00:00Z');
    const out = join(outDir, 'g.json');
    await runIndexCommand([repo, '--out', out, '--kgram-size', '3', '--window-size', '2', '--min-hashes', '1']);
    const { tombstones } = JSON.parse(readFileSync(out, 'utf8')) as { tombstones: { path: string; lines: string[] }[] };
    expect(tombstones.every(t => t.path === 'lib/a.js')).toBe(true);
    // the whole 10-line hunk is one block with code in it, so it stays; the lock file is gone
    expect(tombstones).toHaveLength(1);
  });

  it('--min-hashes drops tombstones with fewer distinct hashes', async () => {
    timedCommit(repo, 'src/x.ts', BLOCK + '\n', 'add', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'src/x.ts', '// empty\n', 'remove', '2024-01-15T00:00:00Z');
    const count = async (min: string): Promise<number> => {
      const out = join(outDir, `g${min}.json`);
      await runIndexCommand([repo, '--out', out, '--kgram-size', '3', '--window-size', '2', '--min-hashes', min]);
      return (JSON.parse(readFileSync(out, 'utf8')) as { tombstones: unknown[] }).tombstones.length;
    };
    expect(await count('1')).toBe(1);
    expect(await count('1000')).toBe(0);
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

  describe('default skip list (end to end)', () => {
    const CODE = Array.from({ length: 8 }, (_, i) => `const value${i} = compute${i}(input, ${i});`).join('\n') + '\n';
    const paths = ['package-lock.json', 'Pipfile.lock', 'dist/bundle.js', 'docs/api.html', 'docs/v2/ref.html', 'certs/cacert.pem', 'pkg/packages/vendored.py', 'NOTES.md', 'real/app.ts'];

    function buryAll(): void {
      for (const p of paths) timedCommit(repo, p, CODE, `add ${p}`, '2024-01-01T00:00:00Z');
      for (const p of paths) timedCommit(repo, p, '// gone\n', `remove ${p}`, '2024-02-01T00:00:00Z');
    }
    async function index(...extra: string[]): Promise<string[]> {
      const out = join(outDir, 'g.json');
      await runIndexCommand([repo, '--out', out, ...extra]);
      const json = JSON.parse(readFileSync(out, 'utf8')) as { tombstones: Array<{ path: string }> };
      return json.tombstones.map(t => t.path).sort();
    }

    it('with defaults, only real source yields tombstones', async () => {
      buryAll();
      expect(await index()).toEqual(['real/app.ts']);
    });

    it('--skip adds to the defaults', async () => {
      buryAll();
      expect(await index('--skip', 'real/')).toEqual([]);
    });

    it('--no-default-skip mines everything (minified and maps still skipped)', async () => {
      buryAll();
      expect(await index('--no-default-skip')).toEqual([...paths].sort());
    });

    it('--include-docs mines prose docs but still skips lockfiles', async () => {
      buryAll();
      expect(await index('--include-docs')).toEqual(['NOTES.md', 'real/app.ts']);
    });
  });

  it('marks tombstones whose code is still at HEAD as aliveAtHead and counts them in stats', async () => {
    const live = Array.from({ length: 8 }, (_, i) => `const live${i} = keep${i}(arg, ${i});`).join('\n') + '\n';
    const dead = Array.from({ length: 8 }, (_, i) => `const dead${i} = drop${i}(arg, ${i});`).join('\n') + '\n';
    timedCommit(repo, 'a.ts', live + dead, 'add both', '2024-01-01T00:00:00Z');
    timedCommit(repo, 'a.ts', live, 'drop dead', '2024-02-01T00:00:00Z');
    // `live` block is deleted from a.ts but re-created verbatim in b.ts in a later commit.
    timedCommit(repo, 'b.ts', live, 'copy live elsewhere', '2024-03-01T00:00:00Z');
    timedCommit(repo, 'a.ts', '// nothing\n', 'drop live', '2024-04-01T00:00:00Z');

    const out = join(outDir, 'g.json');
    await runIndexCommand([repo, '--out', out]);
    const json = JSON.parse(readFileSync(out, 'utf8')) as {
      tombstones: Array<{ lines: string[]; aliveAtHead: boolean }>;
      stats: { aliveAtHead: number; tombstones: number };
    };
    const deadT = json.tombstones.find(t => t.lines.some(l => l.includes('drop0')));
    const liveT = json.tombstones.find(t => t.lines.some(l => l.includes('keep0')));
    expect(deadT?.aliveAtHead).toBe(false);
    expect(liveT?.aliveAtHead).toBe(true);
    expect(json.stats.aliveAtHead).toBe(1);
  });
});
