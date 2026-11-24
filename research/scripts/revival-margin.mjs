// Research script: for every revival record a graveyard reports, the revival's windowed similarity, the share of the tombstone's
// fingerprint in the parent tree and in the lines the commit deletes, and the reviewer's verdict (research/labels/).
// The margin of aliveMargin is read off the difference similarity - present (research/matching-eval.md section 11).
// Usage: npm run build && node research/scripts/revival-margin.mjs <dir with <repo>.json graveyards mined with --alive-margin=-1 (nothing rejected)> <dir with the clones>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const D = fileURLToPath(new URL('../../dist', import.meta.url));
const L = fileURLToPath(new URL('../labels/', import.meta.url));
const [GY, CLONES] = process.argv.slice(2);
const { RepoReader } = await import(D + '/miner/repo-reader.js');
const { DEFAULT_MINER_CONFIG: C } = await import(D + '/core/types.js');
const { parseDiff } = await import(D + '/miner/parse-diff.js');
const { changedRuns, unionGrams } = await import(D + '/miner/commit-grams.js');
const { containedIn } = await import(D + '/core/match.js');
const key = r => (r === 'httpie' || r === 'httpie-cli') ? 'cli' : r;
const labels = ['revivals-50-hand.jsonl', 'revivals-new-hand.jsonl'].flatMap(f => readFileSync(L + f, 'utf8').trim().split('\n').map(JSON.parse));
const readds = readFileSync(L + 'true-readds-21.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const verdictOf = (repo, death, rev, path) => labels.filter(x => key(x.repo) === repo && death.startsWith(x.death_commit) && rev.startsWith(x.revival_commit) && x.path === path).map(x => x.verdict)
  .concat(readds.filter(x => key(x.repo) === repo && death.startsWith(x.death_commit) && rev.startsWith(x.readd_commit) && x.path === path).map(() => 'true-readd'));
for (const repo of ['axios', 'cli', 'express', 'flask', 'got', 'requests']) {
  const g = JSON.parse(readFileSync(join(GY, `${repo}.json`)));
  const reader = new RepoReader(join(CLONES, repo), C);
  for (const t of g.tombstones) for (const v of t.revivals) {
    if (v.isMergeArtifact) continue;
    const dir = join(CLONES, repo);
    const raw = execFileSync('git', ['show', '-p', '--no-color', '--format=%s', v.commit], { cwd: dir, maxBuffer: 1e9 }).toString();
    const pc = parseDiff({ hash: v.commit, authorEmail: '', subject: '', body: '', authorDate: '', committerTimestamp: 0, rawDiff: raw }, C.skipPatterns);
    const del = containedIn(t.fingerprint, unionGrams(changedRuns(pc, 'deleted'), C));
    const par = await reader.treeContains(v.commit + '^', t.fingerprint);
    const present = par ? par.size / t.fingerprint.length : 0;
    const verdicts = [...new Set(verdictOf(repo, t.commit, v.commit, t.path))].join('+') || 'unlabelled';
    console.log([repo.padEnd(8), t.commit.slice(0, 8), v.commit.slice(0, 8), verdicts.padEnd(17), 'sim', v.similarity.toFixed(3), 'parent', present.toFixed(3), 'deleted', del.toFixed(3), 'gap', (v.similarity - Math.max(present, del)).toFixed(3), t.path].join(' '));
  }
  reader.close();
}
