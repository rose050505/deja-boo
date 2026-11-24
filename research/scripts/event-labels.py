#!/usr/bin/env python3
"""Count revival events (one per patch) by hand verdict. Usage: event-labels.py <dir with the six graveyards>

An event is "real" when any record of it was labelled real or duplicate_of_real; "ambiguous" when none is real and one is ambiguous;
"false" when every labelled record is false; "unlabelled" when no record is in research/labels/. A record that is in true-readds-21.jsonl counts as real. Merge artifacts are excluded.
"""
import collections, json, os, sys
LABELS = os.path.join(os.path.dirname(__file__), '..', 'labels')
REPOS = ['axios', 'cli', 'express', 'flask', 'got', 'requests']
key = lambda r: 'cli' if r in ('httpie', 'cli', 'httpie-cli') else r
rows = []
for f in ['revivals-50-hand.jsonl', 'revivals-new-hand.jsonl']:
    rows += [json.loads(l) for l in open(os.path.join(LABELS, f))]
readds = [json.loads(l) for l in open(os.path.join(LABELS, 'true-readds-21.jsonl'))]
def verdicts(repo, death, rev, path):
    out = {h['verdict'] for h in rows if key(h['repo']) == repo and death.startswith(h['death_commit']) and rev.startswith(h['revival_commit']) and h['path'] == path}
    if any(key(x['repo']) == repo and death.startswith(x['death_commit']) and rev.startswith(x['readd_commit']) and x['path'] == path for x in readds): out.add('real')  # independently found re-addition
    return out
events = {}
for r in REPOS:
    g = json.load(open(os.path.join(sys.argv[1], f'{r}.json')))
    for t in g['tombstones']:
        for v in t['revivals']:
            if v['isMergeArtifact']: continue
            e = events.setdefault((r, v.get('patchId') or v['commit']), {'revert': False, 'v': set()})
            e['revert'] |= v['isRevert']
            e['v'] |= verdicts(r, t['commit'], v['commit'], t['path'])
c = collections.Counter(); rev = collections.Counter()
for e in events.values():
    k = 'real' if e['v'] & {'real', 'duplicate_of_real'} else 'ambiguous' if 'ambiguous' in e['v'] else 'false' if e['v'] else 'unlabelled'
    c[k] += 1
    if e['revert']: rev[k] += 1
print(f'events {len(events)}: ' + ', '.join(f'{k} {c[k]}' for k in ['real', 'ambiguous', 'false', 'unlabelled']))
print(f'via Revert {sum(rev.values())}: ' + ', '.join(f'{k} {rev[k]}' for k in ['real', 'ambiguous', 'false', 'unlabelled']))
