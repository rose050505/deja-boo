import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIndex } from './index.js';
import { matchWindowed } from '../core/match.js';
import { hauntLevel } from '../core/level.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { Graveyard } from '../core/types.js';

const BUILDER = fileURLToPath(new URL('../test-fixtures/haunted-http.sh', import.meta.url));

describe('haunted-http demo repo', () => {
  let dir: string;
  let graveyard: Graveyard;
  let candidate: string[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-demo-'));
    const repo = join(dir, 'repo');
    execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' });
    graveyard = await runIndex(repo, { ...DEFAULT_MINER_CONFIG, graceDays: 0 });
    const subject = "Use the pool's native chunked mode for uploads";
    const log = execFileSync('git', ['log', '--format=%H %s'], { cwd: repo }).toString().split('\n');
    const commit = log.find(l => l.slice(41) === subject)!.slice(0, 40);
    const adapter = execFileSync('git', ['show', `${commit}:haunted_http/adapter.py`], { cwd: repo }).toString();
    candidate = adapter.replace(/\braw\b/g, 'response').split('\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('has 2 tombstones, both alive at HEAD, with 1 revival via Revert', () => {
    expect(graveyard.stats.tombstones).toBe(2);
    expect(graveyard.stats.revivalsViaRevert).toBe(1);
    expect(graveyard.stats.aliveAtHead).toBe(2);
    expect(graveyard.stats.aliveAtHeadReverts).toBeGreaterThanOrEqual(1);
  });

  it('blocks the renamed re-landing of the reverted variant', () => {
    const revertStone = graveyard.tombstones.find(t => /^revert/i.test(t.causeOfDeath));
    expect(revertStone).toBeDefined();
    expect(revertStone!.aliveAtHead).toBe(true);
    const { similarity } = matchWindowed(revertStone!, candidate);
    expect(hauntLevel(revertStone!, similarity)).toBe('block');
  });
});
