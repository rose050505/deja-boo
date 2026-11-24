import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIndex } from '../miner/index.js';
import { toGraveyardJson } from '../miner/serialize.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import type { Graveyard, RevenantHit, Tombstone } from '../core/types.js';
import { decideStop, gitStopDeps } from './stop-command.js';
import { formatHookEntry } from '../watch/format.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const BUILDER = join(root, 'src/test-fixtures/haunted-http.sh');
const SUBJECT = "Use the pool's native chunked mode for uploads";

describe('Stop hook (REQ-10)', () => {
  let dir: string;
  let repo: string;
  let revert: Tombstone;
  let head: string;
  let native: string;
  const adapter = (): string => join(repo, 'haunted_http/adapter.py');
  const stop = (session: string) => decideStop(session, gitStopDeps(repo));
  const reset = (): void => {
    writeFileSync(adapter(), head);
    rmSync(join(repo, '.deja-boo/stop-state.json'), { force: true });
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-stop-'));
    repo = join(dir, 'repo');
    execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' });
    const g: Graveyard = await runIndex(repo, { ...DEFAULT_MINER_CONFIG, graceDays: 0 });
    mkdirSync(join(repo, '.deja-boo'), { recursive: true });
    writeFileSync(join(repo, '.deja-boo/graveyard.json'), toGraveyardJson(g));
    revert = g.tombstones.find(t => /^revert/i.test(t.causeOfDeath))!;
    head = readFileSync(adapter(), 'utf8');
    const log = execFileSync('git', ['log', '--format=%H %s'], { cwd: repo }).toString().split('\n');
    const commit = log.find(l => l.slice(41) === SUBJECT)!.slice(0, 40);
    native = execFileSync('git', ['show', `${commit}:haunted_http/adapter.py`], { cwd: repo }).toString().replace(/\braw\b/g, 'response');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('shell-style edit to the native adapter: block JSON naming the Revert tombstone and the file', () => {
    reset();
    writeFileSync(adapter(), native);
    const r = stop('s1');
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(out.decision).toBe('block');
    expect(out.reason).toContain(revert.id);
    expect(out.reason).toContain(revert.commit.slice(0, 7));
    expect(out.reason).toContain(`Revert "${SUBJECT}"`);
    expect(out.reason).toMatch(/lines \d+-\d+ of haunted_http\/adapter\.py/);
    expect(out.reason).toContain('These changes resurrect buried code.');
  });

  it('unchanged tree: no output', () => {
    reset();
    expect(stop('s2')).toEqual({ exitCode: 0, stdout: '' });
  });

  it('second Stop in the same session with the same ids: no output; a new session blocks again', () => {
    reset();
    writeFileSync(adapter(), native);
    expect(stop('s3').stdout).not.toBe('');
    expect(stop('s3')).toEqual({ exitCode: 0, stdout: '' });
    expect(stop('s4').stdout).not.toBe('');
  });

  it('acknowledged: no output', () => {
    reset();
    writeFileSync(adapter(), `# deja-boo: checked ${revert.id}\n${native}`);
    expect(stop('s5')).toEqual({ exitCode: 0, stdout: '' });
  });

  it('untracked new file with the buried block blocks; .deja-boo files never count', () => {
    reset();
    writeFileSync(join(repo, 'extra.py'), native);
    const out = JSON.parse(stop('s6').stdout) as { reason: string };
    expect(out.reason).toContain('of extra.py');
    rmSync(join(repo, 'extra.py'));
  });

  it('with an obituary file the Stop reason carries the obituary line; an invalid file is ignored silently', () => {
    const file = join(repo, '.deja-boo/obituaries.json');
    const line = 'Obituary (PR #5353, https://github.com/psf/requests/pull/5353): "A number of PRs were merged without review."';
    try {
      reset();
      writeFileSync(adapter(), native);
      writeFileSync(file, JSON.stringify({ [revert.commit]: { fetchedAt: '2026-05-01T00:00:00Z', issues: [], pr: {
        number: 5353, url: 'https://github.com/psf/requests/pull/5353', title: 't', excerpt: 'A number of PRs were merged without review.', truncated: false } } }));
      const reason = (JSON.parse(stop('o1').stdout) as { reason: string }).reason;
      expect(reason.split('\n')).toContain(line);
      reset();
      writeFileSync(adapter(), native);
      writeFileSync(file, '{bad');
      const plain = (JSON.parse(stop('o2').stdout) as { reason: string }).reason;
      expect(plain).not.toContain('Obituary');
    } finally {
      rmSync(file, { force: true });
      reset();
    }
  });

  it('not a git repo: no output', () => {
    const plain = mkdtempSync(join(tmpdir(), 'deja-boo-plain-'));
    try {
      expect(decideStop('s', gitStopDeps(plain))).toEqual({ exitCode: 0, stdout: '' });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('spawned `node dist/cli/main.js hook` with a Stop event prints block JSON and exits 0', () => {
    const main = join(root, 'dist/cli/main.js');
    if (!existsSync(main)) return;
    reset();
    writeFileSync(adapter(), native);
    const p = spawnSync(process.execPath, [main, 'hook'], { cwd: repo, encoding: 'utf8',
      input: JSON.stringify({ session_id: 's7', hook_event_name: 'Stop', cwd: repo }) });
    expect(p.status).toBe(0);
    expect((JSON.parse(p.stdout) as { decision: string }).decision).toBe('block');
    reset();
  });
});

describe('REQ-5 message punctuation', () => {
  it('does not add a period after a cause that already ends with one', () => {
    const t = { id: 'a'.repeat(40), commit: 'b'.repeat(40), buriedAt: '2026-01-02T00:00:00Z', causeOfDeath: 'Fixes 2da7fe08.', links: [] } as unknown as Tombstone;
    const hit = { tombstone: t, level: 'block', similarity: 0.9, containment: 1, matchedLines: [1, 5] } as unknown as RevenantHit;
    const msg = formatHookEntry(hit);
    expect(msg).toContain('Fixes 2da7fe08. Similarity');
    expect(msg).not.toContain('..');
  });
});
