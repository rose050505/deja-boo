import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { RawCommit, MinerConfig } from '../core/types.js';

/**
 * Thrown when git is not on PATH or the directory is not a git repository.
 */
export class MinerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MinerError';
  }
}

/**
 * Sentinel tokens embedded in the --format string so the parser can split commits
 * without ambiguity even when commit messages contain diff-like content.
 *
 * We use a visible ASCII sentinel (no null bytes) because Node.js spawn rejects
 * null bytes in argument strings.  The sentinel contains a UUID-like segment that
 * will not appear in normal commit messages or diff output.
 *
 * Format produces:
 *   ^^DJBOO-COMMIT^^<hash>^^<email>^^<iso-date>^^<subject>\n<body>^^DJBOO-END^^
 * followed immediately by the diff output from -p.
 */
const COMMIT_SENTINEL = '^^DJBOO-COMMIT^^';
const END_SENTINEL = '^^DJBOO-END^^';
const FIELD_SEP = '^^';
const FORMAT =
  `${COMMIT_SENTINEL}%H${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s%n%b${END_SENTINEL}`;

type ParseState = 'scan' | 'header' | 'diff';

interface Builder {
  hash: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  bodyLines: string[];
  diffLines: string[];
  state: ParseState;
}

function flushBuilder(b: Builder): RawCommit {
  return {
    hash: b.hash,
    authorEmail: b.authorEmail,
    subject: b.subject,
    body: b.bodyLines.join('\n').trimEnd(),
    authorDate: b.authorDate,
    rawDiff: b.diffLines.join('\n'),
  };
}

/**
 * Stream commits from a git repository one at a time.
 * Yields RawCommit objects in reverse-chronological order (git default).
 * Throws MinerError if git is missing or the path is not a git repo.
 */
export async function* spawnGitLog(
  repo: string,
  options: Pick<MinerConfig, 'since' | 'until'>,
): AsyncIterable<RawCommit> {
  // Check git is available and the directory is a git repo.
  await checkGitAvailable();
  await checkIsGitRepo(repo);

  const args = [
    'log',
    '-p',
    '--no-merges',
    '--no-color',
    '--date=iso-strict',
    `--format=${FORMAT}`,
  ];

  if (options.since) args.push(`--since=${options.since}`);
  if (options.until) args.push(`--until=${options.until}`);

  const child = spawn('git', args, {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Collect stderr for error reporting.
  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

  const queue: RawCommit[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let streamError: Error | null = null;

  let builder: Builder | null = null;

  function processLine(line: string): void {
    // Check for COMMIT sentinel anywhere in the line (it may be at the start).
    const sentinelIdx = line.indexOf(COMMIT_SENTINEL);
    if (sentinelIdx !== -1) {
      // Flush previous builder if any.
      if (builder !== null) {
        queue.push(flushBuilder(builder));
        resolveNext?.();
        resolveNext = null;
      }

      // Parse the header fields from the sentinel line.
      // Format after sentinel: hash^^email^^isodate^^subject
      const headerPart = line.slice(sentinelIdx + COMMIT_SENTINEL.length);
      const fields = headerPart.split(FIELD_SEP);
      builder = {
        hash: fields[0] ?? '',
        authorEmail: fields[1] ?? '',
        authorDate: fields[2] ?? '',
        subject: fields[3] ?? '',
        bodyLines: [],
        diffLines: [],
        state: 'header',
      };
      return;
    }

    if (builder === null) return;

    // Check for END sentinel.
    if (line.includes(END_SENTINEL)) {
      // Anything before END_SENTINEL on this line is part of the body.
      const beforeEnd = line.slice(0, line.indexOf(END_SENTINEL));
      if (beforeEnd.length > 0) builder.bodyLines.push(beforeEnd);
      builder.state = 'diff';
      return;
    }

    if (builder.state === 'header') {
      builder.bodyLines.push(line);
    } else {
      builder.diffLines.push(line);
    }
  }

  let childExitCode: number | null = 0;
  let childClosed = false;
  let rlClosed = false;

  function tryFinalize(): void {
    if (!rlClosed || !childClosed) return;
    // If git log exits non-zero after we already confirmed it's a git repo, it's
    // likely an empty repo (no commits). Treat that as empty rather than an error.
    done = true;
    resolveNext?.();
    resolveNext = null;
  }

  rl.on('line', processLine);

  rl.on('close', () => {
    if (builder !== null) {
      queue.push(flushBuilder(builder));
      builder = null;
    }
    rlClosed = true;
    // Don't resolve yet — wait for child to close too (via tryFinalize).
    tryFinalize();
  });

  child.on('error', (err) => {
    streamError = new MinerError(`Failed to spawn git: ${err.message}`);
    done = true;
    resolveNext?.();
    resolveNext = null;
  });

  child.on('close', (code) => {
    childExitCode = code;
    childClosed = true;
    tryFinalize();
  });

  // Yield commits as they arrive.
  while (true) {
    if (streamError !== null) throw streamError;
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) break;
    // Wait for next item.
    await new Promise<void>(resolve => {
      resolveNext = resolve;
    });
  }

  // Drain remaining items after done.
  while (queue.length > 0) {
    if (streamError !== null) throw streamError;
    yield queue.shift()!;
  }

  if (streamError !== null) throw streamError;
}

/** Verify git is on PATH by running `git --version`. */
async function checkGitAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--version'], { stdio: 'ignore' });
    child.on('error', () =>
      reject(new MinerError('git binary not found. Please install git and ensure it is on PATH.')),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new MinerError('git binary not found or not working.'));
    });
  });
}

/** Verify that repo is a git repository (or throw MinerError). */
async function checkIsGitRepo(repo: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', '--git-dir'], {
      cwd: repo,
      stdio: 'ignore',
    });
    child.on('error', () => reject(new MinerError(`Failed to check git repo at ${repo}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new MinerError(`${repo} is not a git repository`));
    });
  });
}
