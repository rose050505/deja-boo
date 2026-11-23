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

  it('exit 3 with how-to when the graveyard is missing', () => {
    const r = runCheck(candidate, undefined, dir);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('deja-boo index . --out .deja-boo/graveyard.json');
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
