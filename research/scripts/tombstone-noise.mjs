// Research script: share of tombstones whose fingerprint is still inside the files the death commit touched, right after it.
// Usage: npm run build && node research/scripts/tombstone-noise.mjs <graveyard dir> <dir with the clones>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const D=fileURLToPath(new URL('../../dist', import.meta.url));
const { RepoReader } = await import(D+'/miner/repo-reader.js');
const { DEFAULT_MINER_CONFIG:C } = await import(D+'/core/types.js');
const { containedIn, fingerprintLines } = await import(D+'/core/match.js');
const [dir, clones]=process.argv.slice(2);
let n=0, hi95=0, hi90=0;
for (const r of ['axios','cli','express','flask','got','requests']){
  const repo=join(clones, r);
  const g=JSON.parse(readFileSync(`${dir}/${r}.json`));
  const rd=new RepoReader(repo,C); const files=new Map();
  for (const t of g.tombstones){
    let fs=files.get(t.commit); if(!fs){fs=execFileSync('git',['diff-tree','--no-commit-id','--name-only','-r',t.commit],{cwd:repo}).toString().trim().split('\n'); files.set(t.commit,fs);}
    const post=await rd.fileGrams(t.commit, fs);
    const fp=fingerprintLines(t.lines,{...C,language:t.language});
    const c=containedIn(fp,post); n++; if(c>=0.95)hi95++; if(c>=0.9)hi90++;
  }
  rd.close();
}
console.log(dir,'tombstones',n,'>=0.95',hi95,(100*hi95/n).toFixed(1)+'%','>=0.90',hi90,(100*hi90/n).toFixed(1)+'%');
