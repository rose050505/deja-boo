import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadGraveyard, loadObituaries, validThresholds } from './load.js';
import { causeText, formatCheckReport, formatHookEntry, formatHookMessage, linkText } from './format.js';
import type { Obituary, ObituaryFile, RevenantHit, Tombstone } from '../core/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deja-boo-watch-')); mkdirSync(join(dir, '.deja-boo')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const cfg = (text: string) => writeFileSync(join(dir, '.deja-boo/config.json'), text);

describe('loadConfig', () => {
  const defaults = { warn: 0.5, block: 0.7 };
  it('missing file: defaults, no note', () => {
    expect(loadConfig(dir)).toEqual({ config: { thresholds: defaults, minHashes: 4 }, notes: [] });
  });
  it('valid thresholds are used', () => {
    cfg('{"thresholds":{"warn":0.6,"block":0.8}}');
    expect(loadConfig(dir).config.thresholds).toEqual({ warn: 0.6, block: 0.8 });
  });
  it.each([['invalid JSON', '{nope'], ['warn > block', '{"thresholds":{"warn":0.9,"block":0.6}}'],
    ['non-number', '{"thresholds":{"warn":"0.5","block":0.7}}'], ['zero warn', '{"thresholds":{"warn":0,"block":0.7}}'],
    ['block above 1', '{"thresholds":{"warn":0.5,"block":1.5}}']])('%s: defaults plus a note', (_n, text) => {
    cfg(text);
    const r = loadConfig(dir);
    expect(r.config.thresholds).toEqual(defaults);
    expect(r.notes).toHaveLength(1);
  });
  it('minHashes: a non-negative integer is used; anything else gives the default plus a note', () => {
    cfg('{"minHashes":0}');
    expect(loadConfig(dir)).toEqual({ config: { thresholds: defaults, minHashes: 0 }, notes: [] });
    cfg('{"thresholds":{"warn":0.6,"block":0.8},"minHashes":7}');
    expect(loadConfig(dir).config).toEqual({ thresholds: { warn: 0.6, block: 0.8 }, minHashes: 7 });
    for (const bad of ['-1', '2.5', '"4"', 'null']) {
      cfg(`{"minHashes":${bad}}`);
      const r = loadConfig(dir);
      expect(r.config.minHashes).toBe(4);
      expect(r.notes).toHaveLength(1);
    }
  });
  it('property: validThresholds is false for non-numbers and true only for 0 < warn <= block <= 1', () => {
    fc.assert(fc.property(fc.anything(), x => !validThresholds({ warn: x, block: 0.9 }) || typeof x === 'number'));
    fc.assert(fc.property(fc.double({ noNaN: false }), fc.double({ noNaN: false }), (w, b) =>
      validThresholds({ warn: w, block: b }) === (w > 0 && w <= b && b <= 1)));
  });
});

describe('loadGraveyard', () => {
  it('undefined when missing or malformed', () => {
    expect(loadGraveyard(dir)).toBeUndefined();
    writeFileSync(join(dir, '.deja-boo/graveyard.json'), '{"x":1}');
    expect(loadGraveyard(dir)).toBeUndefined();
    writeFileSync(join(dir, '.deja-boo/graveyard.json'), 'not json');
    expect(loadGraveyard(dir)).toBeUndefined();
  });
  it('reads a graveyard', () => {
    writeFileSync(join(dir, '.deja-boo/graveyard.json'), '{"tombstones":[],"stats":{}}');
    expect(loadGraveyard(dir)?.tombstones).toEqual([]);
  });
});

const ID = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';
function hit(over: Partial<Tombstone> = {}, h: Partial<RevenantHit> = {}): RevenantHit {
  const tombstone = {
    id: ID, fingerprint: [], lines: ['a', 'b'], path: 'src/a.ts', language: 'typescript',
    buriedAt: '2026-03-02T10:00:00+00:00', buriedAtTimestamp: 0, commit: '1234567890abcdef1234567890abcdef12345678',
    author: 'x@y', causeOfDeath: 'leaked memory', links: [{ type: 'pr', ref: '42' }], revivals: [], deaths: [], ...over,
  } as Tombstone;
  return { tombstone, level: 'block', similarity: 0.8571, containment: 1, matchedLines: [16, 25], ...h };
}

describe('format', () => {
  it('golden: hook entry with cause and link', () => {
    expect(formatHookEntry(hit())).toBe(
      `[block] 👻 Déjà Boo: this code was buried on 2026-03-02 in 1234567 — leaked memory (PR #42). Similarity 0.86 to tombstone ${ID}, lines 16-25 of this write. Read it with the MCP tool get_tombstone. If the cause no longer applies, add the comment \`deja-boo: checked ${ID}\` near the code and write again.`);
  });
  it('golden: empty cause and no links', () => {
    expect(formatHookEntry(hit({ causeOfDeath: '', links: [] }, { level: 'warn' }))).toBe(
      `[warn] 👻 Déjà Boo: this code was buried on 2026-03-02 in 1234567 — cause of death unknown. Similarity 0.86 to tombstone ${ID}, lines 16-25 of this write. Read it with the MCP tool get_tombstone. If the cause no longer applies, add the comment \`deja-boo: checked ${ID}\` near the code and write again.`);
  });
  it('causeText and linkText', () => {
    expect(causeText({ causeOfDeath: '  ' })).toBe('cause of death unknown');
    expect(linkText([{ type: 'pr', ref: '1' }, { type: 'issue', ref: '2' }])).toBe('PR #1, issue #2');
    expect(linkText([])).toBe('');
  });
  it('property: an entry is under 1,200 chars and keeps id, commit7 and line range whatever the cause', () => {
    fc.assert(fc.property(fc.string({ maxLength: 4000 }), cause => {
      const e = formatHookEntry(hit({ causeOfDeath: cause }));
      return e.length <= 1200 && e.includes(ID) && e.includes('1234567') && e.includes('lines 16-25');
    }));
  });
  it('the message shows 3 entries and counts the rest', () => {
    const m = formatHookMessage([hit(), hit(), hit(), hit(), hit()]);
    expect(m.match(/👻/g)).toHaveLength(3);
    expect(m).toContain('… and 2 more buried things');
  });
  it('check report has every field and truncates deleted lines at 20', () => {
    const lines = Array.from({ length: 23 }, (_, i) => `line ${i}`);
    const r = formatCheckReport([hit({ lines })]);
    for (const part of [ID, '1234567890abcdef1234567890abcdef12345678', '2026-03-02T10:00:00+00:00', 'leaked memory', 'PR #42',
      'lines 16-25', 'similarity:  0.86', 'containment: 1.00', '- line 19', '… 3 more lines']) expect(r).toContain(part);
    expect(r).not.toContain('- line 20');
  });
});

const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const URL5353 = 'https://github.com/psf/requests/pull/5353';
const obit = (excerpt = 'A number of PRs were merged back in September without any proper review.', truncated = false): Obituary => ({
  pr: { number: 5353, url: URL5353, title: 'Revert 3362', excerpt, truncated }, issues: [], fetchedAt: '2026-05-01T12:00:00Z',
});
const OBIT_LINE = `Obituary (PR #5353, ${URL5353}): "A number of PRs were merged back in September without any proper review."`;

describe('loadObituaries and loadGraveyard', () => {
  const yardJson = JSON.stringify({ tombstones: [{ ...hit().tombstone }], stats: {} });
  const write = (name: string, text: string) => writeFileSync(join(dir, '.deja-boo', name), text);
  it('missing file: null and no notes; the graveyard is untouched', () => {
    expect(loadObituaries(dir)).toEqual({ file: null, notes: [] });
    write('graveyard.json', yardJson);
    expect(loadGraveyard(dir)?.tombstones[0]).not.toHaveProperty('obituary');
  });
  it('valid file: attaches the entry by death commit and only to matching tombstones', () => {
    write('graveyard.json', yardJson);
    const file: ObituaryFile = { [COMMIT]: obit(), ['f'.repeat(40)]: obit('other') };
    write('obituaries.json', JSON.stringify(file));
    expect(loadObituaries(dir)).toEqual({ file, notes: [] });
    expect(loadGraveyard(dir)?.tombstones[0]?.obituary).toEqual(obit());
    write('obituaries.json', JSON.stringify({ ['e'.repeat(40)]: obit() }));
    expect(loadGraveyard(dir)?.tombstones[0]).not.toHaveProperty('obituary');
  });
  it.each([['not JSON', '{nope'], ['wrong shape', '{"abc":{}}'], ['an array', '[]']])('invalid file (%s): ignored with one note', (_n, text) => {
    write('graveyard.json', yardJson);
    write('obituaries.json', text);
    const r = loadObituaries(dir);
    expect(r.file).toBeNull();
    expect(r.notes).toHaveLength(1);
    expect(loadGraveyard(dir)?.tombstones[0]).not.toHaveProperty('obituary');
  });
});

describe('format with an obituary', () => {
  it('golden: the hook entry has the obituary line under the cause', () => {
    expect(formatHookEntry(hit({ obituary: obit() }))).toBe(
      `[block] 👻 Déjà Boo: this code was buried on 2026-03-02 in 1234567 — leaked memory (PR #42).\n${OBIT_LINE}\n` +
      `Similarity 0.86 to tombstone ${ID}, lines 16-25 of this write. Read it with the MCP tool get_tombstone. If the cause no longer applies, add the comment \`deja-boo: checked ${ID}\` near the code and write again.`);
  });
  it('a title-only obituary leaves the entry unchanged (byte for byte)', () => {
    const plain = formatHookEntry(hit());
    expect(formatHookEntry(hit({ obituary: obit('') }))).toBe(plain);
    expect(formatHookEntry(hit({ obituary: { pr: null, issues: [], fetchedAt: '2026-05-01T00:00:00Z' } }))).toBe(plain);
  });
  it('property: with any cause and excerpt the entry stays <= 1200, keeps the cause start, and the obituary line is <= 500', () => {
    fc.assert(fc.property(fc.string({ maxLength: 4000 }), fc.string({ maxLength: 400 }), fc.boolean(), (cause, excerpt, truncated) => {
      const ex = excerpt.replace(/\s+/g, ' ').trim();
      const e = formatHookEntry(hit({ causeOfDeath: cause, obituary: obit(ex, truncated) }));
      const line = e.split('\n').find(l => l.startsWith('Obituary ('));
      return e.length <= 1200 && e.includes(ID) && e.includes('lines 16-25') && (ex === '' ? line === undefined : line !== undefined && line.length <= 500);
    }));
  });
  it('check report: obituary block, and the three file states', () => {
    const withText = formatCheckReport([hit({ obituary: obit('Why it died', true) })], { [COMMIT]: obit() });
    expect(withText).toContain('  cause:       leaked memory');
    expect(withText).toContain(`    PR #5353, ${URL5353}`);
    expect(withText).toContain('      title:   Revert 3362');
    expect(withText).toContain('      excerpt: "Why it died\u2026"');
    expect(formatCheckReport([hit()], { ['f'.repeat(40)]: obit() })).toContain('  obituary:    not fetched');
    const empty: Obituary = { pr: null, issues: [], fetchedAt: '2026-05-01T12:00:00Z' };
    expect(formatCheckReport([hit()], { [COMMIT]: empty })).toContain('  obituary:    none found on GitHub (looked up 2026-05-01)');
  });
  it('check report without a file is byte-for-byte the old report', () => {
    const h = hit();
    expect(formatCheckReport([h], null)).toBe(formatCheckReport([h]));
    expect(formatCheckReport([h])).not.toContain('obituary');
  });
});
