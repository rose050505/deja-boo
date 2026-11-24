// Research script: for every hand-labelled revival and true re-addition, how much of the tombstone's fingerprint is still present
// at the death commit (in its added lines, and in the touched files after it) and at the revival (added lines, deleted lines,
// parent tree). These numbers set aliveAfterDeath and aliveBeforeRevival (research/matching-eval.md section 9).
// Usage: npm run build && node research/scripts/label-containment.mjs <graveyards of the old miner (they hold the labelled tombstones)> <dir with the clones>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const D=fileURLToPath(new URL('../../dist', import.meta.url));
const L=fileURLToPath(new URL('../labels/', import.meta.url));
const [OLD, CLONES]=process.argv.slice(2);
const { RepoReader } = await import(D+'/miner/repo-reader.js');
const { DEFAULT_MINER_CONFIG:C } = await import(D+'/core/types.js');
const { parseDiff } = await import(D+'/miner/parse-diff.js');
const { changedRuns, unionGrams, gramsByFile } = await import(D+'/miner/commit-grams.js');
const { containedIn, fingerprintLines } = await import(D+'/core/match.js');
const { detectLanguage } = await import(D+'/miner/language.js');
const key=r=>(r==='httpie'||r==='httpie-cli')?'cli':r;
const old={}; for (const r of ['axios','cli','express','flask','got','requests']) old[r]=JSON.parse(readFileSync(join(OLD, `${r}.json`)));
const readers={};
const rd=r=>readers[r]??=new RepoReader(join(CLONES, r),C);
function parsed(r,c){const repo=join(CLONES, r);const full=execFileSync('git',['rev-parse',c],{cwd:repo}).toString().trim();
 const raw=execFileSync('git',['show','-p','--no-color','--format=%s',full],{cwd:repo,maxBuffer:1e9}).toString();
 return parseDiff({hash:full,authorEmail:'',subject:'',body:'',authorDate:'',committerTimestamp:0,rawDiff:raw},C.skipPatterns);}
const rows=[...readFileSync(L+'revivals-50-hand.jsonl','utf8').trim().split('\n').map(JSON.parse).map(x=>({...x,src:'hand'})),
 ...readFileSync(L+'true-readds-21.jsonl','utf8').trim().split('\n').map(JSON.parse).map(x=>({...x,revival_commit:x.readd_commit,verdict:'readd',src:'readd'}))];
for (const x of rows){
  const r=key(x.repo);
  let t=old[r].tombstones.find(t=>t.commit.startsWith(x.death_commit)&&t.path===x.path && t.revivals.some(v=>v.commit.startsWith(x.revival_commit)))
     ?? old[r].tombstones.find(t=>t.commit.startsWith(x.death_commit)&&t.path===x.path);
  let fp, lines;
  if(!t){ // re-extract largest deleted block of that path
    const pc=parsed(r,x.death_commit); const runs=changedRuns(pc,'deleted').filter(b=>b.filePath===x.path&&b.lines.length>=4);
    if(!runs.length){console.log('NOBLOCK',x.verdict,r,x.death_commit,x.path);continue;}
    lines=runs.sort((a,b)=>b.lines.length-a.lines.length)[0].lines;
  } else lines=t.lines;
  fp=fingerprintLines(lines,{...C,language:detectLanguage(x.path)});
  const pd=parsed(r,x.death_commit);
  const full=pd.meta.hash;
  const addD=unionGrams(changedRuns(pd,'added'),C);
  const post=await rd(r).fileGrams(execFileSync('git',['rev-parse',x.death_commit],{cwd:join(CLONES, r)}).toString().trim(), pd.hunks.map(h=>h.filePath));
  const pv=parsed(r,x.revival_commit);
  const rfull=execFileSync('git',['rev-parse',x.revival_commit],{cwd:join(CLONES, r)}).toString().trim();
  let addR=0; for (const s of gramsByFile(changedRuns(pv,'added'),C).values()) addR=Math.max(addR,containedIn(fp,s));
  const delR=containedIn(fp,unionGrams(changedRuns(pv,'deleted'),C));
  const parent=await rd(r).treeContains(rfull+'^',fp);
  // per-file max in parent
  console.log([x.src,x.verdict.padEnd(17),r.padEnd(8),x.death_commit,x.revival_commit,'fp',String(fp.length).padStart(3),'deathAdd',containedIn(fp,addD).toFixed(2),'deathPost',containedIn(fp,post).toFixed(2),'revAdd',addR.toFixed(2),'revDel',delR.toFixed(2),'parent',(parent?parent.size/fp.length:0).toFixed(2), t?'':'(re-extracted)'].join(' '));
}
for (const r of Object.values(readers)) r.close();
