import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIndex } from '../miner/index.js';
import { toGraveyardJson } from '../miner/serialize.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { Graveyard } from '../core/types.js';
import { runCheck } from './check-command.js';

const BUILDER = fileURLToPath(new URL('../test-fixtures/haunted-http.sh', import.meta.url));

describe('runCheck on haunted-http', () => {
  let dir: string;
  let repo: string;
  let graveyard: Graveyard;
  let candidate: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-check-'));
    repo = join(dir, 'repo');
    execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' });
    graveyard = await runIndex(repo, { ...DEFAULT_MINER_CONFIG, graceDays: 0 });
    mkdirSync(join(repo, '.deja-boo'));
    writeFileSync(join(repo, '.deja-boo/graveyard.json'), toGraveyardJson(graveyard));
    const log = execFileSync('git', ['log', '--format=%H %s'], { cwd: repo }).toString().split('\n');
    const commit = log.find(l => l.slice(41) === "Use the pool's native chunked mode for uploads")!.slice(0, 40);
    candidate = execFileSync('git', ['show', `${commit}:haunted_http/adapter.py`], { cwd: repo }).toString().replace(/\braw\b/g, 'response');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exit 2 with the full evidence for the renamed revenant', () => {
    const t = graveyard.tombstones.find(x => /^revert/i.test(x.causeOfDeath))!;
    const r = runCheck(candidate, 'haunted_http/adapter.py', repo);
    expect(r.exitCode).toBe(2);
    for (const part of [t.id, t.commit, t.buriedAt, t.causeOfDeath, 'lines 16-25', 'similarity:', 'containment:', '- ' + t.lines[0]]) {
      expect(r.stdout).toContain(part);
    }
  });

  it('exit 0 for unrelated code and for a skipped path', () => {
    expect(runCheck('const a = 1;\nconst b = 2;\n', undefined, repo).exitCode).toBe(0);
    expect(runCheck(candidate, 'dist/adapter.py', repo).exitCode).toBe(0);
  });

  it('a clean result says what was checked on stderr only; findings print no such line', () => {
    const n = graveyard.tombstones.length;
    const headText = execFileSync('git', ['show', 'HEAD:haunted_http/adapter.py'], { cwd: repo }).toString();
    const a = runCheck(headText, 'haunted_http/adapter.py', repo);
    expect(a).toMatchObject({ exitCode: 0, stdout: '' });
    expect(a.stderr).toBe(`\u2713 clean: haunted_http/adapter.py checked against ${n} tombstones (compared with HEAD)\n`);
    expect(runCheck('const a = 1;\n', undefined, repo).stderr).toBe(`\u2713 clean: input from stdin checked against ${n} tombstones\n`);
    expect(runCheck('const a = 1;\n', 'x.ts', repo, { head: false }).stderr).toContain('whole text, no HEAD comparison');
    expect(runCheck(candidate, 'dist/adapter.py', repo).stderr).toContain('skip list');
    expect(runCheck(candidate, 'haunted_http/adapter.py', repo).stderr).not.toContain('clean');
  });

  it('code already at HEAD does not alarm; --no-head (head: false) keeps the old behaviour', () => {
    const headText = execFileSync('git', ['show', 'HEAD:haunted_http/adapter.py'], { cwd: repo }).toString();
    const withHead = runCheck(headText, 'haunted_http/adapter.py', repo);
    expect(withHead).toMatchObject({ exitCode: 0, stdout: '' });
    const old = runCheck(headText, 'haunted_http/adapter.py', repo, { head: false });
    expect(old.exitCode).toBeGreaterThan(0); // the surviving call overlaps the Revert tombstone
    expect(runCheck(headText, undefined, repo).exitCode).toBe(old.exitCode); // no path: nothing to compare with
  });

  it('a path outside the repo or not tracked at HEAD is checked on its own', () => {
    expect(runCheck(candidate, '../elsewhere/adapter.py', repo).exitCode).toBe(2);
    expect(runCheck(candidate, 'haunted_http/not_tracked.py', repo).exitCode).toBe(2);
  });

  it('obituary file: shows the block (or the not-fetched line); an invalid file is noted on stderr and ignored', () => {
    const t = graveyard.tombstones.find(x => /^revert/i.test(x.causeOfDeath))!;
    const file = join(repo, '.deja-boo/obituaries.json');
    try {
      const plain = runCheck(candidate, 'haunted_http/adapter.py', repo);
      expect(plain.stdout).not.toContain('obituary:');
      writeFileSync(file, JSON.stringify({ ['f'.repeat(40)]: { fetchedAt: '2026-05-01T00:00:00Z', issues: [], pr: null } }));
      expect(runCheck(candidate, 'haunted_http/adapter.py', repo).stdout).toContain('obituary:    not fetched');
      writeFileSync(file, JSON.stringify({ [t.commit]: { fetchedAt: '2026-05-01T00:00:00Z', issues: [], pr: {
        number: 5353, url: 'https://github.com/psf/requests/pull/5353', title: 'Revert 3362', excerpt: 'No review.', truncated: false } } }));
      const r = runCheck(candidate, 'haunted_http/adapter.py', repo);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toContain('PR #5353, https://github.com/psf/requests/pull/5353');
      expect(r.stdout).toContain('excerpt: "No review."');
      writeFileSync(file, '{bad');
      const bad = runCheck(candidate, 'haunted_http/adapter.py', repo);
      expect(bad.stdout).toBe(plain.stdout);
      expect(bad.stderr).toContain('obituaries.json is not a valid obituary file');
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('exit 3 with how-to when the graveyard is missing', () => {
    const r = runCheck(candidate, undefined, dir);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('no graveyard at .deja-boo/graveyard.json');
    expect(r.stderr).toContain('deja-boo index');
  });

  it('exit 1 when the best level is warn (block threshold 1 and an imperfect match)', () => {
    writeFileSync(join(repo, '.deja-boo/config.json'), '{"thresholds":{"warn":0.5,"block":1}}');
    const edited = candidate.split('\n').filter((_, i) => i !== 18).join('\n'); // one line fewer: similarity < 1
    const r = runCheck(edited, undefined, repo);
    expect(r.exitCode).toBe(1);
    writeFileSync(join(repo, '.deja-boo/config.json'), '{bad');
    const bad = runCheck(candidate, undefined, repo);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain('not valid JSON');
    rmSync(join(repo, '.deja-boo/config.json'));
  });
});
