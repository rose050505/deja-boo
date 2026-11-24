// Research script: does the identifier-renamed score catch agent-style rewrites, and what does it cost in false alarms?
//
// Positives: every watched tombstone with >= 8 lines, mutated the way an agent rewrites code, scored against its own tombstone
//   with the best window (window = tombstone line count), as `check` does.
// Negatives: (1) the tombstone's own lines vs a random unrelated tombstone of the same repo in another file;
//   (2) ordinary commits replayed like the PreToolUse hook: before = parent version of each touched file, after = the commit's version,
//       against the tombstones buried before that commit.
// Scores: scoreTombstone with the renamed score off (raw windowed Jaccard, what shipped before) and with (penalty p, raw floor f):
//   max(raw, renamed - p) over windows whose raw Jaccard is >= f.
//
// Usage: npm run build && node research/scripts/rename-eval.mjs <graveyard dir with <repo>.json> <dir with the repo clones>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const D = new URL('../../dist/', import.meta.url);
const { findRevenants, scoreTombstone, TextIndex } = await import(new URL('core/watch.js', D));
const { DEFAULT_MINER_CONFIG: C } = await import(new URL('core/types.js', D));
const { isSkippedPath } = await import(new URL('core/skip.js', D));

const [gdir, rdir] = process.argv.slice(2);
const REPOS = ['axios', 'cli', 'express', 'flask', 'got', 'requests'];
let seed = 20261124;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'def', 'class', 'import', 'from', 'self',
  'this', 'true', 'false', 'True', 'False', 'None', 'null', 'undefined', 'new', 'in', 'not', 'and', 'or', 'is', 'try', 'except', 'catch',
  'finally', 'raise', 'throw', 'with', 'as', 'pass', 'elif', 'lambda', 'async', 'await', 'yield', 'typeof', 'instanceof', 'export',
  'default', 'require', 'module', 'exports']);
const SYN = ['value', 'result', 'item', 'data', 'opts', 'resp', 'ctx', 'handler', 'target', 'entry'];
function idents(lines) {
  const counts = new Map();
  for (const l of lines) for (const m of l.matchAll(/[A-Za-z_]\w*/g)) {
    if (KEYWORDS.has(m[0]) || m[0].length < 3) continue;
    counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  return [...counts.keys()].sort();
}
function renameN(lines, lo, hi) {
  const pool = idents(lines);
  const n = Math.min(pool.length, lo + Math.floor(rnd() * (hi - lo + 1)));
  if (n < lo) return null;
  const chosen = new Set();
  while (chosen.size < n) chosen.add(pool[Math.floor(rnd() * pool.length)]);
  let out = lines;
  for (const id of chosen) {
    const to = SYN[Math.floor(rnd() * SYN.length)] + id.length;
    const re = new RegExp(`\\b${id}\\b`, 'g');
    out = out.map(l => l.replace(re, to));
  }
  return out;
}
function reorder(lines) {
  // Swap two adjacent lines with the same indentation, twice (statement order changed, content kept).
  const out = lines.slice();
  let swaps = 0;
  for (let tries = 0; tries < 20 && swaps < 2; tries++) {
    const i = Math.floor(rnd() * (out.length - 1));
    const ind = l => l.match(/^\s*/)[0].length;
    if (ind(out[i]) !== ind(out[i + 1]) || out[i].trim() === out[i + 1].trim()) continue;
    [out[i], out[i + 1]] = [out[i + 1], out[i]];
    swaps++;
  }
  return swaps === 2 ? out : null;
}
const M = {
  'rename 1 identifier': L => renameN(L, 1, 1),
  'rename 2-4 identifiers': L => renameN(L, 2, 4),
  'reorder statements (2 swaps)': reorder,
  'rename 2-4 + reorder': L => { const a = renameN(L, 2, 4); return a && reorder(a); },
  'drop ~20% of lines': L => { const out = L.filter(() => rnd() >= 0.2); return out.length >= 4 ? out : null; },
};
/** Scoring variants: raw only, then (penalty, raw floor) pairs for the renamed score. */
const CONFIGS = [
  { name: 'raw only', penalty: Infinity, rawFloor: 2 },
  { name: 'p=0.1 floor 0', penalty: 0.1, rawFloor: 0 },
  { name: 'p=0.1 floor 0.2', penalty: 0.1, rawFloor: 0.2 },
  { name: 'p=0.15 floor 0.2', penalty: 0.15, rawFloor: 0.2 },
  { name: 'p=0.2 floor 0.2', penalty: 0.2, rawFloor: 0.2 },
  { name: 'p=0.2 floor 0.3 (shipped)', penalty: 0.2, rawFloor: 0.3 },
];
/** The shipped scorer (scoreTombstone) for every config; scores below 0.5 are not computed exactly, which does not change the shares below. */
const scores = (t, cand) => { const text = new TextIndex(cand); return CONFIGS.map(c => scoreTombstone(t, text, 0.5, 4, c).similarity); };
const caught = (s, i, th) => s[i] >= th;
const watched = t => t.fingerprint.length >= 4 && (t.aliveAtHead !== true || /^revert/i.test(t.causeOfDeath));

const pos = {};
const neg = [];
let stones = 0;
for (const repo of REPOS) {
  const g = JSON.parse(readFileSync(join(gdir, `${repo}.json`), 'utf8'));
  const big = g.tombstones.filter(t => t.lines.length >= 8 && watched(t));
  stones += big.length;
  for (const t of big) {
    for (const [name, fn] of Object.entries(M)) {
      const m = fn(t.lines);
      if (!m) continue;
      (pos[name] ??= []).push(scores(t, m));
    }
    for (let tries = 0; tries < 5; tries++) {
      const o = big[Math.floor(rnd() * big.length)];
      if (o.path === t.path) continue;
      neg.push(scores(t, o.lines));
      break;
    }
  }
}
const pct = (xs, f) => (100 * xs.filter(f).length / xs.length).toFixed(1) + '%';
console.log(`watched tombstones >= 8 lines: ${stones}; seed 20261124`);
for (const th of [0.5, 0.7]) {
  console.log(`\nShare of mutated copies scoring >= ${th} against their own tombstone`);
  console.log('\n| Mutation | n | ' + CONFIGS.map(c => c.name).join(' | ') + ' |');
  console.log('|---|---|' + CONFIGS.map(() => '---').join('|') + '|');
  for (const [name, xs] of Object.entries(pos)) console.log(`| ${name} | ${xs.length} | ` + CONFIGS.map((c, i) => pct(xs, s => caught(s, i, th))).join(' | ') + ' |');
  console.log(`| unrelated tombstone pairs (false alarms) | ${neg.length} | ` + CONFIGS.map((c, i) => pct(neg, s => caught(s, i, th))).join(' | ') + ' |');
}

// Ordinary commits replayed through findRevenants (the shipped scorer, RENAME_PENALTY), against the tombstones buried before each commit.
let writes = 0;
let blocks = 0;
const tally = CONFIGS.map(() => ({ alarms: 0, alarmWrites: 0 }));
const examples = [];
for (const repo of REPOS) {
  const dir = join(rdir, repo);
  const g = JSON.parse(readFileSync(join(gdir, `${repo}.json`), 'utf8'));
  const hashes = execFileSync('git', ['rev-list', '--no-merges', 'HEAD'], { cwd: dir }).toString().trim().split('\n');
  const picked = [];
  while (picked.length < 50) {
    const h = hashes[Math.floor(rnd() * hashes.length)];
    const subj = execFileSync('git', ['log', '-1', '--format=%s', h], { cwd: dir }).toString();
    if (/^revert|restore|re-?add|bring back/i.test(subj) || picked.includes(h)) continue;
    picked.push(h);
  }
  for (const h of picked) {
    const ts = Number(execFileSync('git', ['log', '-1', '--format=%ct', h], { cwd: dir }).toString());
    const graveyard = { tombstones: g.tombstones.filter(t => t.buriedAtTimestamp < ts), stats: {} };
    const files = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=AM', '-r', h], { cwd: dir }).toString().trim().split('\n').filter(f => f && !isSkippedPath(f, C.skipPatterns));
    for (const f of files.slice(0, 10)) {
      const show = rev => { try { return execFileSync('git', ['show', `${rev}:${f}`], { cwd: dir, maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };
      const after = show(h);
      if (after.includes('\0') || after.length > 1e6) continue;
      const before = show(`${h}^`);
      writes++;
      CONFIGS.forEach((c, i) => {
        const hits = findRevenants(graveyard, after.split('\n'), { warn: 0.5, block: 0.7 }, before === '' ? [] : before.split('\n'), { rename: c });
        if (c.name.endsWith('(shipped)')) blocks += hits.filter(x => x.renamed && x.level === 'block').length;
        if (!hits.length) return;
        tally[i].alarmWrites++;
        tally[i].alarms += hits.length;
        if (c.name.endsWith('(shipped)')) examples.push(`${repo} ${h.slice(0, 8)} ${f}: ${hits.map(x => `${x.tombstone.commit.slice(0, 8)} ${x.similarity.toFixed(2)}${x.renamed ? ' renamed' : ''}`).join(', ')}`);
      });
    }
  }
}
console.log(`\nOrdinary commits replayed (hook-style before/after, 50 random non-restore commits per repo, ${writes} file writes)`);
console.log('\n| Scoring | writes with an alarm | alarms |');
console.log('|---|---|---|');
CONFIGS.forEach((c, i) => console.log(`| ${c.name} | ${tally[i].alarmWrites} (${(100 * tally[i].alarmWrites / writes).toFixed(1)}%) | ${tally[i].alarms} |`));
console.log('\nAlarms with the shipped scoring (p=0.2 floor 0.3):');
for (const e of examples) console.log('  ' + e);
console.log(`Renamed-only hits at level block (must be 0): ${blocks}`);

