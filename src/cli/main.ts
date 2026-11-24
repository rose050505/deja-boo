#!/usr/bin/env node
/**
 * deja-boo CLI entry point.
 *
 * Usage:
 *   deja-boo index [repo] [options]   Mine git history and write a graveyard JSON.
 *   deja-boo --help                   Print this help.
 *
 *   deja-boo check [--no-head] <file|->  Match a file (or stdin) against .deja-boo/graveyard.json.
 *
 *   deja-boo obituary [options]       Ask GitHub why code died and write .deja-boo/obituaries.json (the only command that uses the network).
 *
 *   deja-boo hook                     Kiro PreToolUse adapter: event JSON on stdin, exit 2 blocks.
 *
 *   deja-boo mcp                      Start the MCP server on stdio.
 */

import { runIndexCommand } from './index-command.js';
import { runCheckCommand } from './check-command.js';
import { runHookCommand } from './hook-command.js';
import { obituaryMain } from './obituary-command.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';

const [, , subcommand, ...rest] = process.argv;

if (subcommand === 'index') {
  runIndexCommand(rest).catch((err: unknown) => {
    process.stderr.write(`deja-boo: unexpected error: ${String(err)}\n`);
    process.exit(1);
  });
} else if (subcommand === 'check') {
  runCheckCommand(rest);
} else if (subcommand === 'obituary') {
  await obituaryMain(rest);
} else if (subcommand === 'hook') {
  runHookCommand();
} else if (subcommand === 'mcp') {
  await import('../mcp/server.js');
} else if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
  console.log(`deja-boo — your codebase remembers what it buried.

Usage:
  deja-boo index [repo] [options]
  deja-boo check [--no-head] <file|->
                             exit 0 clean, 1 warn, 2 block, 3 no graveyard. A file inside the repo is compared with its
                             HEAD version, so only what the new text makes worse is reported; --no-head checks the text alone
  deja-boo obituary [--repo owner/name] [--limit N] [--graveyard <file>] [--out <file>]
                             Look up the pull requests and issues behind death commits on GitHub (the only command that
                             uses the network); writes .deja-boo/obituaries.json. Token: GITHUB_TOKEN, else \`gh auth token\`, else none
  deja-boo hook              Kiro PreToolUse adapter (event JSON on stdin): exit 2 blocks, 1 fails open
  deja-boo mcp               Start the MCP server on stdio (check_snippet, get_tombstone, list_graveyard)

  repo                  Path to git repository (default: current directory)

Options for \`obituary\`:
  --repo <owner/name>   GitHub repository (default: the github.com origin remote of the current directory)
  --limit <n>           Death commits to look up, newest Reverts first (default: 300)
  --graveyard <file>    Graveyard to read (default: .deja-boo/graveyard.json)
  --out <file>          Obituary file to write (default: .deja-boo/obituaries.json); entries already in it are kept

Options for \`index\`:
  --out <file>          Output JSON path (default: <repo>/.deja-boo/graveyard.json, the path check and the hooks read)
  --min-block-lines <n> Minimum deleted lines per block (default: ${DEFAULT_MINER_CONFIG.minBlockLines})
  --min-hashes <n>      Fewest distinct fingerprint hashes a tombstone needs (default: ${DEFAULT_MINER_CONFIG.minHashes})
  --kgram-size <n>      k-gram width for fingerprinting (default: ${DEFAULT_MINER_CONFIG.kgramSize})
  --window-size <n>     Winnowing window size (default: ${DEFAULT_MINER_CONFIG.windowSize})
  --rename-ids          Normalise identifier names before fingerprinting
  --move-threshold <n>  Share of a tombstone's fingerprint that added lines must contain to re-add it (default: ${DEFAULT_MINER_CONFIG.moveThreshold})
  --grace-days <n>      Days after deletion within which a re-add drops the tombstone (default: ${DEFAULT_MINER_CONFIG.graceDays})
  --alive-after-death <n>
                        A deleted block whose fingerprint is at least this share in the commit's added lines or touched
                        files afterwards was moved or reformatted, not killed (default: ${DEFAULT_MINER_CONFIG.aliveAfterDeath})
  --alive-before-revival <n>
                        Skip a revival when at least this share of the fingerprint is still in the parent tree
                        (default: ${DEFAULT_MINER_CONFIG.aliveBeforeRevival})
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
