import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { decideHook } from './hook-command.js';
import type { HookDeps } from './hook-command.js';
import { fingerprintLines } from '../core/match.js';
import type { Graveyard, Tombstone } from '../core/types.js';
import { DEFAULT_THRESHOLDS } from '../watch/load.js';

const CWD = '/repo';
const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);

const block = (tag: string): string[] =>
  Array.from({ length: 10 }, (_, i) => `  const ${tag}${i} = ${tag}Call${i}(arg${i}, ${i * 7}, opts.${tag});`);

function stone(id: string, lines: string[], over: Partial<Tombstone> = {}): Tombstone {
  return {
    id, fingerprint: fingerprintLines(lines), lines, path: 'src/a.ts', language: 'typescript',
    buriedAt: '2026-03-02T00:00:00Z', buriedAtTimestamp: 0, commit: 'c'.repeat(40), author: 'x@y',
    causeOfDeath: 'leaked memory (PR #42)', links: [{ type: 'pr', ref: '42' }], revivals: [], deaths: [], ...over,
  };
}
const yard = (...tombstones: Tombstone[]): Graveyard => ({ tombstones, stats: {} as Graveyard['stats'] });

const deps = (files: Record<string, string>, graveyard: Graveyard | undefined): HookDeps => ({
  readFile: p => files[p],
  graveyard,
  config: { thresholds: { ...DEFAULT_THRESHOLDS } },
});
const ev = (tool_name: string, tool_input: unknown): string =>
  JSON.stringify({ hook_event_name: 'preToolUse', cwd: CWD, session_id: 's', tool_name, tool_input });

const A = block('alpha');
const B = block('beta');
const G = yard(stone(ID_A, A), stone(ID_B, B));
const live = ['export function live() {', '  return 1;', '}'];

describe('decideHook', () => {
  it('fs_write of a new file containing a buried block: exit 2 with evidence', () => {
    const r = decideHook(ev('fs_write', { path: 'src/new.ts', text: [...live, ...A].join('\n') }), deps({}, G));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(ID_A);
    expect(r.stderr).toContain('leaked memory (PR #42)');
    expect(r.stderr).toContain('lines 4-13');
    expect(r.stderr).not.toContain(ID_B);
  });

  it('fs_write rewrite: exit 2 when the block is new, 0 when the disk file already had it', () => {
    const path = '/repo/src/a.ts';
    expect(decideHook(ev('fs_write', { path: 'src/a.ts', text: [...live, ...A].join('\n') }), deps({ [path]: live.join('\n') }, G)).exitCode).toBe(2);
    const has = [...live, ...A].join('\n');
    expect(decideHook(ev('fs_write', { path: 'src/a.ts', text: has + '\n// tail' }), deps({ [path]: has }, G)).exitCode).toBe(0);
  });

  it('property (a): a write whose post-write text equals the disk text never fires', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...A, ...B, ...live), { maxLength: 30 }), lines => {
      const text = lines.join('\n');
      expect(decideHook(ev('fs_write', { path: 'src/a.ts', text }), deps({ '/repo/src/a.ts': text }, G))).toEqual({ exitCode: 0, stderr: '' });
    }), { numRuns: 100 });
  });

  it('a rewrite that reuses live lines but moves toward the buried variant fires; an unrelated edit to the same file does not', () => {
    const path = '/repo/src/a.ts';
    const disk = [...live, ...A.slice(0, 7), 'tail1();', 'tail2();', 'tail3();'].join('\n');
    const toward = [...live, ...A].join('\n');
    expect(decideHook(ev('fs_write', { path: 'src/a.ts', text: toward }), deps({ [path]: disk }, G)).exitCode).toBe(2);
    expect(decideHook(ev('fs_write', { path: 'src/a.ts', text: disk + '\nmore();' }), deps({ [path]: disk }, G)).exitCode).toBe(0);
  });

  it('fs_write that only changes whitespace: exit 0', () => {
    const path = '/repo/src/a.ts';
    const has = [...live, ...A].join('\n');
    const reindented = [...live, ...A.map(l => '\t' + l.trim() + '  ')].join('\n');
    expect(decideHook(ev('fs_write', { path: 'src/a.ts', text: reindented }), deps({ [path]: has }, G)).exitCode).toBe(0);
  });

  it('str_replace: exit 2 when newStr brings the block in; first vs all occurrences; no-match is exit 0', () => {
    const path = '/repo/src/a.ts';
    const disk = [...live, '// MARK', 'x();', '// MARK'].join('\n');
    const newStr = A.join('\n');
    const first = decideHook(ev('str_replace', { path: 'src/a.ts', oldStr: '// MARK', newStr }), deps({ [path]: disk }, G));
    expect(first.exitCode).toBe(2);
    expect(first.stderr).toContain('lines 4-13');
    const all = decideHook(ev('str_replace', { path: 'src/a.ts', oldStr: '// MARK', newStr, replace_all: true }), deps({ [path]: disk }, G));
    expect(all.exitCode).toBe(2);
    expect(decideHook(ev('str_replace', { path: 'src/a.ts', oldStr: 'absent', newStr }), deps({ [path]: disk }, G)).exitCode).toBe(0);
    expect(decideHook(ev('str_replace', { path: 'src/a.ts', oldStr: '// MARK', newStr: 'y();' }), deps({ [path]: disk }, G)).exitCode).toBe(0);
  });

  it('other tool: exit 0, silent, even without a graveyard', () => {
    const r = decideHook(ev('execute_bash', { command: 'ls' }), deps({}, undefined));
    expect(r).toEqual({ exitCode: 0, stderr: '' });
  });

  it('skipped path: exit 0 and silent', () => {
    const r = decideHook(ev('fs_write', { path: 'dist/out.js', text: A.join('\n') }), deps({}, G));
    expect(r).toEqual({ exitCode: 0, stderr: '' });
    expect(decideHook(ev('fs_write', { path: '/repo/package-lock.json', text: A.join('\n') }), deps({}, G)).exitCode).toBe(0);
  });

  it('invalid JSON or missing fields: exit 1 with one line', () => {
    for (const raw of ['{nope', '[]', 'null', ev('fs_write', { text: 'x' }), ev('fs_write', { path: 'a.ts' }), ev('str_replace', { path: 'a.ts', oldStr: 'x' }), JSON.stringify({ cwd: CWD })]) {
      const r = decideHook(raw, deps({}, G));
      expect(r.exitCode).toBe(1);
      expect(r.stderr.trim().split('\n')).toHaveLength(1);
    }
  });

  it('missing graveyard: exit 1 with the how-to, but only when there is something to check', () => {
    const r = decideHook(ev('fs_write', { path: 'src/new.ts', text: A.join('\n') }), deps({}, undefined));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('deja-boo index . --out .deja-boo/graveyard.json');
  });

  it('acknowledgement: full gives 0, partial lists only the remaining id', () => {
    const text = [...A, ...B].join('\n');
    const both = text + `\n// deja-boo: checked ${ID_A}\n# deja-boo: checked ${ID_B}`;
    expect(decideHook(ev('fs_write', { path: 'src/n.ts', text: both }), deps({}, G)).exitCode).toBe(0);
    const partial = decideHook(ev('fs_write', { path: 'src/n.ts', text: text + `\n// deja-boo: checked ${ID_A}` }), deps({}, G));
    expect(partial.exitCode).toBe(2);
    expect(partial.stderr).toContain(`tombstone ${ID_B}`);
    expect(partial.stderr).not.toContain(`tombstone ${ID_A}`);
  });

  it('str_replace acknowledgement is read from newStr only', () => {
    const path = '/repo/src/a.ts';
    const disk = `// deja-boo: checked ${ID_A}\n// MARK`;
    const r = decideHook(ev('str_replace', { path: 'src/a.ts', oldStr: '// MARK', newStr: A.join('\n') }), deps({ [path]: disk }, G));
    expect(r.exitCode).toBe(2);
    const ok = decideHook(ev('str_replace', { path: 'src/a.ts', oldStr: '// MARK', newStr: A.join('\n') + `\n// deja-boo: checked ${ID_A}` }), deps({ [path]: disk }, G));
    expect(ok.exitCode).toBe(0);
  });

  it('property: exit is 0 iff every matched id is acknowledged; acknowledging all always gives 0', () => {
    const tag = fc.stringMatching(/^[a-z]{4,8}$/);
    fc.assert(fc.property(
      fc.uniqueArray(tag, { minLength: 1, maxLength: 3 }),
      fc.infiniteStream(fc.boolean()),
      (tags, bools) => {
        const stones = tags.map((t, i) => stone(String(i).repeat(40).slice(0, 40), block(t)));
        const text = tags.flatMap(t => block(t)).join('\n');
        const g = yard(...stones);
        const none = decideHook(ev('fs_write', { path: 'n.ts', text }), deps({}, g));
        expect(none.exitCode).toBe(2);
        const all = stones.map(s => `// deja-boo: checked ${s.id}`).join('\n');
        expect(decideHook(ev('fs_write', { path: 'n.ts', text: text + '\n' + all }), deps({}, g)).exitCode).toBe(0);
        const it = bools[Symbol.iterator]();
        const acked = stones.filter(() => it.next().value as boolean);
        const r = decideHook(ev('fs_write', { path: 'n.ts', text: text + '\n' + acked.map(s => `// deja-boo: checked ${s.id}`).join('\n') }), deps({}, g));
        expect(r.exitCode).toBe(acked.length === stones.length ? 0 : 2);
        for (const s of stones) expect(r.stderr.includes(`tombstone ${s.id}`)).toBe(!acked.includes(s) && r.exitCode === 2 && stones.indexOf(s) < 3);
      },
    ), { numRuns: 40 });
  });
});

describe('hook latency', () => {
  it('1,500 tombstones, 300-line write: decideHook answers under 200 ms', () => {
    let seed = 12345;
    const rnd = (): number => { // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const word = (): string => Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 26)]).join('');
    const line = (): string => `  const ${word()} = ${word()}(${word()}, ${Math.floor(rnd() * 999)}, opts.${word()});`;
    const stones = Array.from({ length: 1500 }, (_, i) => {
      const lines = Array.from({ length: 6 + Math.floor(rnd() * 20) }, line);
      return stone(i.toString(16).padStart(40, '0'), lines);
    });
    const text = Array.from({ length: 300 }, line).join('\n');
    const d = deps({}, yard(...stones));
    const event = ev('fs_write', { path: 'src/big.ts', text });
    decideHook(event, d); // warm-up
    const t0 = performance.now();
    const r = decideHook(event, d);
    const ms = performance.now() - t0;
    console.log(`hook latency: ${ms.toFixed(1)} ms`);
    expect(r.exitCode).toBe(0);
    expect(ms).toBeLessThan(200);
  });
});
