import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { MinerConfig } from '../core/types.js';
import { isSkippedPath } from '../core/skip.js';
import { kgramSetOfLines } from '../core/match.js';
import { detectLanguage } from './language.js';

const MAX_FILE_BYTES = 1_000_000;
/** Most cached blob fingerprints, in hashes (4 bytes each), before new blobs are no longer cached. */
const MAX_CACHED_HASHES = 25_000_000;

type GramConfig = Pick<MinerConfig, 'kgramSize' | 'windowSize' | 'renameIds' | 'skipPatterns'>;

type CatChild = ChildProcessByStdio<Writable, Readable, null>;

interface GitObject {
  oid: string;
  type: string;
  body: Buffer;
}

/** One long-lived `git cat-file --batch`: requests are answered in order, so reading many blobs costs no process spawns. */
class CatFile {
  private child: CatChild | undefined;
  private buf: Buffer = Buffer.alloc(0);
  private readonly waiters: Array<(o: GitObject | null) => void> = [];

  constructor(private readonly repo: string) {}

  private start(): CatChild {
    if (this.child) return this.child;
    const child = spawn('git', ['cat-file', '--batch'], { cwd: this.repo, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdout.on('data', (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
    child.stdin.on('error', () => { /* git may exit early */ });
    child.on('error', () => this.failAll());
    child.on('close', () => this.failAll());
    this.child = child;
    return child;
  }

  private failAll(): void {
    for (const w of this.waiters.splice(0)) w(null);
  }

  private drain(): void {
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) return;
      const header = this.buf.toString('utf8', 0, nl);
      // "<oid> <type> <size>" is followed by the body; anything else ("<spec> missing", "<oid> submodule", "<spec> ambiguous") has none.
      const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(header);
      if (!m) {
        this.buf = this.buf.subarray(nl + 1);
        this.waiters.shift()?.(null);
        continue;
      }
      const [, oid = '', type = '', size = '0'] = m;
      const n = parseInt(size, 10);
      if (this.buf.length < nl + 1 + n + 1) return;
      const body = this.buf.subarray(nl + 1, nl + 1 + n);
      this.buf = this.buf.subarray(nl + n + 2);
      this.waiters.shift()?.({ oid, type, body });
    }
  }

  read(spec: string): Promise<GitObject | null> {
    if (spec.includes('\n')) return Promise.resolve(null);
    const child = this.start();
    return new Promise(resolve => {
      this.waiters.push(resolve);
      child.stdin.write(`${spec}\n`);
    });
  }

  close(): void {
    this.child?.stdin.end();
    this.child = undefined;
  }
}

function run(repo: string, args: string[]): Promise<{ code: number | null; out: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.on('error', reject);
    child.on('close', code => resolve({ code, out: Buffer.concat(out) }));
  });
}

/** Sorted distinct k-gram hashes of a text file's content, or null for binary content. */
function blobGrams(body: Buffer, path: string, config: GramConfig): Uint32Array | null {
  if (body.includes(0)) return null;
  const set = kgramSetOfLines(body.toString('utf8').split('\n'), { ...config, language: detectLanguage(path) });
  return Uint32Array.from(set).sort();
}

function hasHash(sorted: Uint32Array, h: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid] as number;
    if (v === h) return true;
    if (v < h) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Read-only questions about a repository's history that the miner asks while walking it.
 * Every answer is a function of the repository, so the same repo gives the same results.
 */
export class RepoReader {
  private readonly cat: CatFile;
  private readonly cache = new Map<string, Uint32Array | null>();
  private cachedHashes = 0;
  private readonly ancestry = new Map<string, boolean>();

  constructor(private readonly repo: string, private readonly config: GramConfig) {
    this.cat = new CatFile(repo);
  }

  /** Union of the full k-gram hash sets of `paths` as they are in `commit`; missing and binary files add nothing. */
  async fileGrams(commit: string, paths: Iterable<string>): Promise<Set<number>> {
    const out = new Set<number>();
    for (const path of new Set(paths)) {
      const obj = await this.cat.read(`${commit}:${path}`);
      if (!obj || obj.type !== 'blob' || obj.body.length > MAX_FILE_BYTES) continue;
      const grams = this.gramsOf(obj.oid, obj.body, path);
      if (grams) for (const h of grams) out.add(h);
    }
    return out;
  }

  private gramsOf(oid: string, body: Buffer, path: string): Uint32Array | null {
    const key = `${oid}:${detectLanguage(path)}`;
    if (this.cache.has(key)) return this.cache.get(key) as Uint32Array | null;
    const grams = blobGrams(body, path, this.config);
    if (this.cachedHashes < MAX_CACHED_HASHES) {
      this.cache.set(key, grams);
      this.cachedHashes += grams?.length ?? 0;
    }
    return grams;
  }

  /**
   * The hashes of `wanted` that occur as a k-gram in some tracked, non-skipped text file of the tree at `rev`.
   * Returns null when `rev` does not exist (for example the parent of a root commit).
   */
  async treeContains(rev: string, wanted: readonly number[]): Promise<Set<number> | null> {
    let listing: Buffer;
    try {
      const r = await run(this.repo, ['ls-tree', '-r', '-l', '-z', rev]);
      if (r.code !== 0) return null;
      listing = r.out;
    } catch {
      return null;
    }
    const found = new Set<number>();
    const entries: Array<{ oid: string; path: string }> = [];
    for (const entry of listing.toString('utf8').split('\0')) {
      // "<mode> <type> <oid> <size>\t<path>"
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      const [, type, oid = '', size] = entry.slice(0, tab).split(/\s+/);
      const path = entry.slice(tab + 1);
      if (type !== 'blob' || path.includes('\n') || Number(size) > MAX_FILE_BYTES) continue;
      if (isSkippedPath(path, this.config.skipPatterns)) continue;
      entries.push({ oid, path });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const { oid, path } of entries) {
      const key = `${oid}:${detectLanguage(path)}`;
      let grams = this.cache.get(key);
      if (grams === undefined && !this.cache.has(key)) {
        const obj = await this.cat.read(oid);
        grams = obj ? this.gramsOf(oid, obj.body, path) : null;
      }
      if (!grams) continue;
      for (const h of wanted) if (!found.has(h) && hasHash(grams, h)) found.add(h);
      if (found.size === wanted.length) break;
    }
    return found;
  }

  /** True when `ancestor` is reachable from `descendant` (`git merge-base --is-ancestor`). */
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const key = `${ancestor}..${descendant}`;
    const known = this.ancestry.get(key);
    if (known !== undefined) return known;
    let ok = false;
    try {
      ok = (await run(this.repo, ['merge-base', '--is-ancestor', ancestor, descendant])).code === 0;
    } catch {
      ok = false;
    }
    this.ancestry.set(key, ok);
    return ok;
  }

  close(): void {
    this.cat.close();
  }
}
