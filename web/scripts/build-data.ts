/**
 * Builds web/public/graveyards/*.json from local clones.
 *
 * Usage: npm run web:data -- <requests> <express> <axios> <flask> <got> <cli> [more clones]
 * A clone is a path, or `name=path`. The name defaults to the directory name; `cli` becomes `httpie-cli`.
 * The demo repo `haunted-http` is always rebuilt from src/test-fixtures/haunted-http.sh in a temp dir.
 * Needs `npm run build` first (the npm script does that).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Graveyard, GraveyardStats, Tombstone } from '../../src/core/types.ts';
import { parseObituaryFile } from '../../src/core/obituary.ts';
import { isWatched, stripGraveyard, type Fingerprinter } from './strip.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'web/public/graveyards');
const MAX_BYTES = 3 * 1024 * 1024;

/** GitHub slug per repo name; `null` means no remote (the demo). */
const SLUGS: Record<string, string | null> = {
  requests: 'psf/requests',
  express: 'expressjs/express',
  axios: 'axios/axios',
  flask: 'pallets/flask',
  got: 'sindresorhus/got',
  'httpie-cli': 'httpie/cli',
  'haunted-http': null,
};
const ORDER = ['requests', 'express', 'axios', 'flask', 'got', 'httpie-cli', 'haunted-http'];
const ALIASES: Record<string, string> = { cli: 'httpie-cli' };

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])]));
  }
  return v;
}

function json(v: unknown): string {
  return JSON.stringify(sortKeys(v)) + '\n';
}

function parseClone(arg: string): { name: string; path: string } {
  const eq = arg.indexOf('=');
  if (eq > 0 && !arg.slice(0, eq).includes('/')) return { name: arg.slice(0, eq), path: resolve(arg.slice(eq + 1)) };
  const base = basename(resolve(arg));
  return { name: ALIASES[base] ?? base, path: resolve(arg) };
}

function indexRepo(repo: string, outFile: string): Graveyard {
  execFileSync('node', [join(ROOT, 'dist/cli/main.js'), 'index', repo, '--out', outFile], { stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(readFileSync(outFile, 'utf8')) as Graveyard;
}

/** Attach `<clone>/.deja-boo/obituaries.json` entries to tombstones by death commit; returns how many tombstones gained one. A missing file changes nothing; an invalid one is an error. */
function attachObituaries(clone: string, tombstones: Tombstone[]): number {
  const file = join(clone, '.deja-boo/obituaries.json');
  if (!existsSync(file)) return 0;
  const parsed = parseObituaryFile(JSON.parse(readFileSync(file, 'utf8')));
  if (parsed === null) throw new Error(`${file} is not a valid obituary file`);
  let n = 0;
  for (const t of tombstones) {
    const o = parsed[t.commit];
    if (o !== undefined) { t.obituary = o; n++; }
  }
  return n;
}

async function main(): Promise<void> {
  const clones = process.argv.slice(2).map(parseClone);
  if (clones.length === 0) {
    console.error('usage: npm run web:data -- <requests> <express> <axios> <flask> <got> <cli>');
    process.exit(1);
  }
  for (const c of clones) {
    if (!(c.name in SLUGS)) throw new Error(`unknown repo "${c.name}" (use name=path); known: ${ORDER.join(', ')}`);
    if (c.name === 'haunted-http') throw new Error('haunted-http is built from the fixture; do not pass it');
  }

  const match = (await import(pathToFileURL(join(ROOT, 'dist/core/match.js')).href)) as {
    fingerprintLines: (lines: string[], config: Record<string, unknown>) => number[];
  };
  const types = (await import(pathToFileURL(join(ROOT, 'dist/core/types.js')).href)) as { DEFAULT_MINER_CONFIG: Record<string, unknown> };
  const fingerprintOf: Fingerprinter = (lines, language) => match.fingerprintLines(lines, { ...types.DEFAULT_MINER_CONFIG, language });
  const statsMod = (await import(pathToFileURL(join(ROOT, 'dist/miner/stats.js')).href)) as {
    computeStats: (t: Tombstone[], commits: number) => GraveyardStats;
  };

  const tmp = mkdtempSync(join(tmpdir(), 'deja-boo-web-'));
  try {
    const demoDir = join(tmp, 'haunted-http');
    execFileSync('bash', [join(ROOT, 'src/test-fixtures/haunted-http.sh'), demoDir], { stdio: ['ignore', 'ignore', 'inherit'] });
    const sources = [...clones, { name: 'haunted-http', path: demoDir }].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

    mkdirSync(OUT, { recursive: true });
    const perRepo: Record<string, GraveyardStats> = {};
    const publicTombstones: Tombstone[] = [];
    /** The tombstones the web lists (watched: not alive at HEAD, or a Revert); the stats strip counts these so it matches the list. */
    const shownTombstones: Tombstone[] = [];
    let publicCommits = 0;
    let publicRepos = 0;
    const index: { name: string; github: string | null; tombstones: number; mined: number }[] = [];

    for (const { name, path } of sources) {
      const full = indexRepo(path, join(tmp, `${name}.json`));
      const withObit = attachObituaries(path, full.tombstones);
      perRepo[name] = full.stats;
      if (name !== 'haunted-http') {
        publicTombstones.push(...full.tombstones);
        shownTombstones.push(...full.tombstones.filter(isWatched));
        publicCommits += full.stats.commits;
        publicRepos++;
      }
      const stripped = stripGraveyard(full.tombstones, fingerprintOf);
      const text = json(stripped);
      const bytes = Buffer.byteLength(text);
      if (bytes >= MAX_BYTES) throw new Error(`${name}.json is ${bytes} bytes; limit is ${MAX_BYTES}`);
      writeFileSync(join(OUT, `${name}.json`), text);
      index.push({ name, github: SLUGS[name] ?? null, tombstones: stripped.length, mined: full.tombstones.length });
      console.log(`${name.padEnd(13)} mined ${String(full.tombstones.length).padStart(5)}  kept ${String(stripped.length).padStart(5)}  ${(bytes / 1024).toFixed(0)} KB${withObit > 0 ? `  obituaries on ${withObit}` : ''}`);
    }

    const total = statsMod.computeStats(publicTombstones, publicCommits);
    const shown = statsMod.computeStats(shownTombstones, publicCommits);
    writeFileSync(join(OUT, 'index.json'), json(index));
    writeFileSync(
      join(ROOT, 'web/public/stats.json'),
      json({
        repos: publicRepos,
        commits: total.commits,
        tombstones: total.tombstones,
        tombstonesShown: shown.tombstones,
        // Revivals of the tombstones the page lists; revivals of tombstones still alive at HEAD are not listed, so they are counted apart.
        revivals: shown.revivals,
        revivalsViaRevert: shown.revivalsViaRevert,
        medianRevivalGapDays: shown.medianRevivalGapDays,
        revivalsAllTombstones: total.revivals,
        perRepo,
      }),
    );
    console.log(
      `public total: ${publicRepos} repos, ${total.commits} commits, ${total.tombstones} tombstones (${shown.tombstones} listed), ${total.revivals} revivals (${total.revivalsViaRevert} via Revert); listed tombstones: ${shown.revivals} revivals (${shown.revivalsViaRevert} via Revert), median gap ${shown.medianRevivalGapDays} days`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

await main();
