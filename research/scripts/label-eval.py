#!/usr/bin/env python3
"""Compare a set of graveyards with the reviewer's hand labels (research/labels/).

Usage: python3 research/scripts/label-eval.py <dir with axios.json cli.json express.json flask.json got.json requests.json>

A labelled revival counts as reported when some tombstone buried by the labelled death commit, at the labelled path,
has a revival record whose commit starts with the labelled revival commit.
"""
import collections, json, os, sys

LABELS = os.path.join(os.path.dirname(__file__), '..', 'labels')
REPOS = ['axios', 'cli', 'express', 'flask', 'got', 'requests']
FALSE = {'reformat', 'move_refactor', 'boilerplate', 'non_ancestor', 'duplicate_patch'}
REAL = {'real', 'duplicate_of_real'}

def key(repo): return 'cli' if repo in ('httpie', 'cli', 'httpie-cli') else repo

def main(d):
    g = {r: json.load(open(os.path.join(d, f'{r}.json'))) for r in REPOS}
    def reported(repo, death, rev, path):
        return any(t['commit'].startswith(death) and t['path'] == path and any(v['commit'].startswith(rev) for v in t['revivals'])
                   for t in g[key(repo)]['tombstones'])
    hand = [json.loads(l) for l in open(os.path.join(LABELS, 'revivals-50-hand.jsonl'))]
    c = collections.Counter()
    for h in hand:
        hit = reported(h['repo'], h['death_commit'], h['revival_commit'], h['path'])
        c[(h['verdict'], hit)] += 1
        if (h['verdict'] in REAL) != hit and h['verdict'] != 'ambiguous':
            print(f"  {'kept ' if hit else 'lost '} {h['verdict']:17} {h['repo']:8} {h['death_commit']} -> {h['revival_commit']} {h['path']}")
    real = sum(n for (v, hit), n in c.items() if v in REAL and hit), sum(n for (v, _), n in c.items() if v in REAL)
    false = sum(n for (v, hit), n in c.items() if v in FALSE and not hit), sum(n for (v, _), n in c.items() if v in FALSE)
    amb = sum(n for (v, hit), n in c.items() if v == 'ambiguous' and hit), sum(n for (v, _), n in c.items() if v == 'ambiguous')
    print(f'real kept {real[0]}/{real[1]}; false dropped {false[0]}/{false[1]}; ambiguous kept {amb[0]}/{amb[1]}')
    readds = [json.loads(l) for l in open(os.path.join(LABELS, 'true-readds-21.jsonl'))]
    found = [x for x in readds if reported(x['repo'], x['death_commit'], x['readd_commit'], x['path'])]
    print(f'true re-additions found {len(found)}/{len(readds)}; of those the old miner missed: {sum(1 for x in found if not x["reported"])}')
    for x in readds:
        if x not in found: print(f"  miss {x['repo']:8} {x['death_commit']} -> {x['readd_commit']} {x['path']}")
    labelled = {(key(h['repo']), h['death_commit'], h['revival_commit']) for h in hand} | {(key(x['repo']), x['death_commit'], x['readd_commit']) for x in readds}
    records, events, unl = 0, set(), []
    for r in REPOS:
        for t in g[r]['tombstones']:
            for v in t['revivals']:
                if v['isMergeArtifact']: continue
                records += 1
                events.add((r, v.get('patchId') or v['commit']))
                if not any(r == lr and t['commit'].startswith(ld) and v['commit'].startswith(lv) for lr, ld, lv in labelled):
                    unl.append(f"  {r:8} {t['commit'][:8]} -> {v['commit'][:8]} {t['path']} | {v['subject'][:60]}")
    print(f'revival records {records}, events {len(events)}, unlabelled records {len(unl)}')
    print('\n'.join(unl))

if __name__ == '__main__':
    main(sys.argv[1])
