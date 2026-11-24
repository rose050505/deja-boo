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
//
// Part 2 (coverage): node research/scripts/obituary-eval.mjs --coverage <dir with the six clones> [--json]
// For each clone, reads <clone>/.deja-boo/graveyard.json and <clone>/.deja-boo/obituaries.json (written by `deja-boo obituary`) and counts, per repo:
//   tombstones with a reason before (>= 1 link in the commit message) and after (a link, or an obituary entry with a PR or issue excerpt);
//   the same for Revert tombstones (and the stricter 'explicit' reason: a PR or issue link, not a bare #N) (first line starts with revert, revert(s|ed|ing), as in src/core/revert.ts);
//   death commits, commits looked up (an entry exists), commits with obituary text.
// A Revert subject alone is not counted as a "reason" here: it says THAT the code was reverted, not WHY.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv[2] === '--coverage') {
  const root = process.argv[3];
  if (!root) { console.error('usage: node research/scripts/obituary-eval.mjs --coverage <dir with clones> [--json]'); process.exit(1); }
  const isRevert = s => /^\s*revert(?:s|ed|ing)?\b/i.test(s.split('\n')[0]);
  const hasText = o => o !== undefined && ((o.pr !== null && o.pr.excerpt !== '') || o.issues.some(i => i.excerpt !== ''));
  const rows = [];
  for (const repo of ['requests', 'express', 'axios', 'flask', 'got', 'cli']) {
    const g = JSON.parse(readFileSync(join(root, repo, '.deja-boo/graveyard.json'), 'utf8'));
    const f = join(root, repo, '.deja-boo/obituaries.json');
    const ob = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    const r = { repo, tombstones: g.tombstones.length, withReasonBefore: 0, withReasonAfter: 0, reverts: 0, revertsReasonBefore: 0, revertsReasonAfter: 0, revertsExplicitBefore: 0, revertsExplicitAfter: 0,
      commits: new Set(g.tombstones.map(t => t.commit)).size, lookedUp: 0, withText: 0, tombstonesWithObituaryText: 0 };
    const seen = new Set();
    for (const t of g.tombstones) {
      const before = t.links.length > 0;
      const text = hasText(ob[t.commit]);
      const after = before || text;
      r.withReasonBefore += before; r.withReasonAfter += after; r.tombstonesWithObituaryText += text;
      if (isRevert(t.causeOfDeath)) { r.reverts++; r.revertsReasonBefore += before; r.revertsReasonAfter += after;
        const explicit = t.links.some(l => l.type !== 'ref'); r.revertsExplicitBefore += explicit; r.revertsExplicitAfter += explicit || text; }
      if (!seen.has(t.commit)) { seen.add(t.commit); r.lookedUp += ob[t.commit] !== undefined; r.withText += text; }
    }
    rows.push(r);
  }
  const tot = rows.reduce((a, r) => Object.fromEntries(Object.keys(r).filter(k => k !== 'repo').map(k => [k, (a[k] ?? 0) + r[k]])), {});
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows, tot }, null, 1)); process.exit(0); }
  const cols = ['tombstones', 'withReasonBefore', 'withReasonAfter', 'tombstonesWithObituaryText', 'reverts', 'revertsReasonBefore', 'revertsReasonAfter', 'revertsExplicitBefore', 'revertsExplicitAfter', 'commits', 'lookedUp', 'withText'];
  console.log(['repo'.padEnd(9), ...cols.map(c => c.padStart(c.length))].join(' '));
  for (const r of [...rows, { repo: 'total', ...tot }]) console.log([r.repo.padEnd(9), ...cols.map(c => String(r[c]).padStart(c.length))].join(' '));
  process.exit(0);
}

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
