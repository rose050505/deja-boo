#!/usr/bin/env node
/**
 * deja-boo CLI entry point.
 *
 * Usage:
 *   deja-boo index [repo] [options]   Mine git history and write a graveyard JSON.
 *   deja-boo --help                   Print this help.
 *
 * Subcommands `check` and `hook` are reserved for spec 2.
 */

import { runIndexCommand } from './index-command.js';

const [, , subcommand, ...rest] = process.argv;

if (subcommand === 'index') {
  runIndexCommand(rest).catch((err: unknown) => {
    process.stderr.write(`deja-boo: unexpected error: ${String(err)}\n`);
    process.exit(1);
  });
} else if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
  console.log(`deja-boo — your codebase remembers what it buried.

Usage:
  deja-boo index [repo] [options]

  repo                  Path to git repository (default: current directory)

Options for \`index\`:
  --out <file>          Output JSON path (default: graveyard.json)
  --min-block-lines <n> Minimum deleted lines per block (default: 4)
  --kgram-size <n>      k-gram width for fingerprinting (default: 5)
  --window-size <n>     Winnowing window size (default: 4)
  --rename-ids          Normalise identifier names before fingerprinting
  --move-threshold <n>  Jaccard threshold for move detection (default: 0.9)
  --grace-days <n>      Days after deletion within which a re-add drops the tombstone (default: 5)
  --since <date>        Only walk commits after this date
  --until <date>        Only walk commits before this date
  --skip <pattern>      Also skip files matching this glob (repeatable; adds to the defaults)
  --no-default-skip     Do not apply the default skip list (lockfiles, dist/, vendored, certs, ...)
  --include-docs        Also mine prose docs (*.md, *.rst, *.txt), skipped by default
`);
} else {
  process.stderr.write(`deja-boo: unknown subcommand '${subcommand}'. Run 'deja-boo --help'.\n`);
  process.exit(1);
}
