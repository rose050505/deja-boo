// Research script, part 1: what does the single Revert predicate (src/core/revert.ts) change on the real graveyards?
//
// Today three different tests are in use:
//   A  /^revert/i on the whole cause of death      (isRevertCause: alive filter, web cracked stones, stats)
//   B  /^revert\b/i on the whole cause of death    (hauntLevel evidence)
//   C  subject.startsWith('Revert')                (revival-tracker isRevert)
// The new one: D = /^\s*revert(s|ed|ing)?\b/i on the first line.
//
// For every tombstone: Revert status A -> D and B -> D; level at similarity 0.6 (warn zone) and 0.8 (block zone) with the old and new rules;
// for every revival: isRevert C -> D (the stored isRevert is checked against C first).
//
// Usage: node research/scripts/obituary-eval.mjs <dir with <repo>.json graveyards from `deja-boo index`> [--json]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node research/scripts/obituary-eval.mjs <graveyard dir>'); process.exit(1); }
const REPOS = ['requests', 'express', 'axios', 'flask', 'got', 'cli'];
const W = 0.5, B = 0.7;

const A = s => /^revert/i.test(s);
const Bp = s => /^revert\b/i.test(s);
const C = s => s.startsWith('Revert');
const D = s => /^\s*revert(?:s|ed|ing)?\b/i.test(s.split('\n')[0]);

const oldLevel = (t, sim) => {
  if (t.aliveAtHead === true && !A(t.causeOfDeath)) return 'none';
  if (sim < W) return 'none';
  return sim >= B && (Bp(t.causeOfDeath) || t.links.length > 0) ? 'block' : 'warn';
};
const newLevel = (t, sim) => {
  if (t.aliveAtHead === true && !D(t.causeOfDeath)) return 'none';
  if (sim < W) return 'none';
  return sim >= B && (D(t.causeOfDeath) || t.links.length > 0) ? 'block' : 'warn';
};
const subj = s => s.split('\n')[0];

const out = [];
const tot = { tombstones: 0, aliveFilterChange: 0, evidenceChange: 0, levelChange: 0, revivals: 0, revivalChange: 0, storedMismatch: 0 };
for (const repo of REPOS) {
  const g = JSON.parse(readFileSync(join(dir, `${repo}.json`), 'utf8'));
  const r = { repo, tombstones: g.tombstones.length, A: 0, B: 0, D: 0, aliveFilterChange: [], evidenceChange: [], levelChange: [], revivals: 0, revivalChange: [], storedMismatch: 0 };
  for (const t of g.tombstones) {
    const a = A(t.causeOfDeath), b = Bp(t.causeOfDeath), d = D(t.causeOfDeath);
    r.A += a; r.B += b; r.D += d;
    if (a !== d) r.aliveFilterChange.push({ from: a, to: d, aliveAtHead: t.aliveAtHead === true, subject: subj(t.causeOfDeath) });
    if (b !== d) r.evidenceChange.push({ from: b, to: d, subject: subj(t.causeOfDeath), links: t.links.length });
    for (const sim of [0.6, 0.8]) {
      const o = oldLevel(t, sim), n = newLevel(t, sim);
      if (o !== n) r.levelChange.push({ sim, from: o, to: n, aliveAtHead: t.aliveAtHead === true, links: t.links.length, subject: subj(t.causeOfDeath) });
    }
    for (const v of t.revivals) {
      r.revivals++;
      if (v.isRevert !== C(v.subject)) r.storedMismatch++;
      if (C(v.subject) !== D(v.subject)) r.revivalChange.push({ from: C(v.subject), to: D(v.subject), subject: subj(v.subject) });
    }
  }
  out.push(r);
  tot.tombstones += r.tombstones; tot.aliveFilterChange += r.aliveFilterChange.length; tot.evidenceChange += r.evidenceChange.length;
  tot.levelChange += r.levelChange.length; tot.revivals += r.revivals; tot.revivalChange += r.revivalChange.length; tot.storedMismatch += r.storedMismatch;
}
if (process.argv.includes('--json')) { console.log(JSON.stringify({ out, tot }, null, 1)); process.exit(0); }

console.log('repo        tombstones  A(/^revert/i)  B(/^revert\\b/i)  D(new)  aliveFilter A->D  evidence B->D  level changes  revivals  revival C->D');
for (const r of out) {
  console.log(`${r.repo.padEnd(11)} ${String(r.tombstones).padStart(10)}  ${String(r.A).padStart(13)}  ${String(r.B).padStart(16)}  ${String(r.D).padStart(6)}  ${String(r.aliveFilterChange.length).padStart(16)}  ${String(r.evidenceChange.length).padStart(13)}  ${String(r.levelChange.length).padStart(13)}  ${String(r.revivals).padStart(8)}  ${String(r.revivalChange.length).padStart(12)}`);
}
console.log(`total       ${String(tot.tombstones).padStart(10)}  ${' '.repeat(13)}  ${' '.repeat(16)}  ${' '.repeat(6)}  ${String(tot.aliveFilterChange).padStart(16)}  ${String(tot.evidenceChange).padStart(13)}  ${String(tot.levelChange).padStart(13)}  ${String(tot.revivals).padStart(8)}  ${String(tot.revivalChange).padStart(12)}`);
console.log(`stored RevivalRecord.isRevert disagrees with startsWith('Revert') on ${tot.storedMismatch} revivals`);
for (const r of out) {
  for (const [k, label] of [['aliveFilterChange', 'Revert status A -> D'], ['evidenceChange', 'Evidence B -> D'], ['levelChange', 'Level change'], ['revivalChange', 'Revival isRevert C -> D']]) {
    if (r[k].length === 0) continue;
    console.log(`\n${r.repo}: ${label}`);
    for (const c of r[k]) console.log('  ' + JSON.stringify(c));
  }
}
