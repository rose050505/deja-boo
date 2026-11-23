import { spawn } from 'node:child_process';
import type { MinerConfig } from '../core/types.js';
import { isSkippedPath } from '../core/skip.js';
import { fingerprintLines } from '../core/match.js';

const MAX_FILE_BYTES = 1_000_000;
const CHUNK = 200;

function run(repo: string, args: string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'ignore'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`git ${args[0]} exited ${code}`)),
    );
    child.stdin.on('error', () => { /* git may exit early */ });
    child.stdin.end(input ?? '');
  });
}

/** Parse `git cat-file --batch` output into file contents (missing objects are dropped). */
function parseBatch(buf: Buffer): string[] {
  const files: string[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = buf.toString('utf8', pos, nl).split(' ');
    pos = nl + 1;
    if (header[1] !== 'blob') continue;
    const size = parseInt(header[2] as string, 10);
    const body = buf.subarray(pos, pos + size);
    pos += size + 1;
    if (body.includes(0)) continue; // binary
    files.push(body.toString('utf8'));
  }
  return files;
}

/**
 * Fingerprint every tracked text file at HEAD, honouring the same skip list as the miner.
 * Returns the union of all file fingerprints, or null when the repo has no HEAD.
 */
export async function fingerprintHead(repo: string, config: Pick<MinerConfig, 'skipPatterns' | 'kgramSize' | 'windowSize' | 'renameIds'>): Promise<Set<number> | null> {
  let listing: string;
  try {
    listing = (await run(repo, ['ls-tree', '-r', '-l', '-z', 'HEAD'])).toString('utf8');
  } catch {
    return null;
  }

  const paths: string[] = [];
  for (const entry of listing.split('\0')) {
    // "<mode> <type> <oid> <size>\t<path>"
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [, type, , size] = entry.slice(0, tab).split(/\s+/);
    const path = entry.slice(tab + 1);
    if (type !== 'blob' || path.includes('\n')) continue;
    if (Number(size) > MAX_FILE_BYTES) continue;
    if (isSkippedPath(path, config.skipPatterns)) continue;
    paths.push(path);
  }
  paths.sort();

  const head = new Set<number>();
  for (let i = 0; i < paths.length; i += CHUNK) {
    const input = paths.slice(i, i + CHUNK).map(p => `HEAD:${p}\n`).join('');
    const out = await run(repo, ['cat-file', '--batch'], input);
    for (const text of parseBatch(out)) {
      for (const h of fingerprintLines(text.split('\n'), config)) head.add(h);
    }
  }
  return head;
}
