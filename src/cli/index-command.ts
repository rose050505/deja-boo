import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { MinerConfig } from '../core/types.js';
import { DEFAULT_MINER_CONFIG } from '../core/types.js';
import { resolveSkipPatterns } from '../core/skip.js';
import { runIndexWithStats } from '../miner/index.js';
import { toGraveyardJson } from '../miner/serialize.js';
import { MinerError } from '../miner/git-log.js';

/**
 * Entry point for `deja-boo index [repo] [options]`.
 * Parses CLI args, runs the miner, writes graveyard JSON, and prints a summary.
 */
export async function runIndexCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      'min-block-lines': { type: 'string' },
      'min-hashes': { type: 'string' },
      'kgram-size': { type: 'string' },
      'window-size': { type: 'string' },
      'rename-ids': { type: 'boolean', default: false },
      'move-threshold': { type: 'string' },
      'grace-days': { type: 'string' },
      'alive-after-death': { type: 'string' },
      'alive-margin': { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      skip: { type: 'string', multiple: true },
      'no-default-skip': { type: 'boolean', default: false },
      'include-docs': { type: 'boolean', default: false },
    },
  });

  const repo = resolve(positionals[0] ?? '.');
  // Default: where `check`, the hooks and the MCP server read it.
  const out = values.out !== undefined ? resolve(values.out) : join(repo, '.deja-boo', 'graveyard.json');

  // Build config without optional properties first, then conditionally add them.
  const baseConfig: MinerConfig = {
    ...DEFAULT_MINER_CONFIG,
    minBlockLines:
      values['min-block-lines'] !== undefined
        ? parseInt(values['min-block-lines'] as string, 10)
        : DEFAULT_MINER_CONFIG.minBlockLines,
    minHashes:
      values['min-hashes'] !== undefined
        ? parseInt(values['min-hashes'] as string, 10)
        : DEFAULT_MINER_CONFIG.minHashes,
    kgramSize:
      values['kgram-size'] !== undefined
        ? parseInt(values['kgram-size'] as string, 10)
        : DEFAULT_MINER_CONFIG.kgramSize,
    windowSize:
      values['window-size'] !== undefined
        ? parseInt(values['window-size'] as string, 10)
        : DEFAULT_MINER_CONFIG.windowSize,
    renameIds: (values['rename-ids'] as boolean | undefined) ?? DEFAULT_MINER_CONFIG.renameIds,
    moveThreshold:
      values['move-threshold'] !== undefined
        ? parseFloat(values['move-threshold'] as string)
        : DEFAULT_MINER_CONFIG.moveThreshold,
    graceDays:
      values['grace-days'] !== undefined
        ? parseInt(values['grace-days'] as string, 10)
        : DEFAULT_MINER_CONFIG.graceDays,
    aliveAfterDeath:
      values['alive-after-death'] !== undefined
        ? parseFloat(values['alive-after-death'] as string)
        : DEFAULT_MINER_CONFIG.aliveAfterDeath,
    aliveMargin:
      values['alive-margin'] !== undefined
        ? parseFloat(values['alive-margin'] as string)
        : DEFAULT_MINER_CONFIG.aliveMargin,
    skipPatterns: resolveSkipPatterns({
      extra: (values['skip'] as string[] | undefined) ?? [],
      defaults: values['no-default-skip'] !== true,
      includeDocs: values['include-docs'] === true,
    }),
  };

  // Add optional date filters only when provided (exactOptionalPropertyTypes: true).
  if (values['since'] !== undefined) baseConfig.since = values['since'] as string;
  if (values['until'] !== undefined) baseConfig.until = values['until'] as string;

  try {
    const { graveyard, stats } = await runIndexWithStats(repo, baseConfig);

    // Write output — create parent directory if needed.
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, toGraveyardJson(graveyard), 'utf8');

    // Print summary.
    console.log(`Commits walked   : ${stats.commitsWalked}`);
    console.log(`Hunks parsed     : ${stats.hunksParsed}`);
    console.log(`Blocks found     : ${stats.blocksFound}`);
    console.log(`Moves excluded   : ${stats.movesExcluded}`);
    console.log(`Skipped tiny     : ${stats.skippedEmpty} (empty, or fewer than ${baseConfig.minHashes} distinct hashes)`);
    console.log(`Grace dropped    : ${stats.graceDropped}`);
    console.log(`Tombstones added : ${stats.tombstonesAdded}`);
    console.log(`Revivals found   : ${stats.revivals} (events: one per patch)`);
    console.log(`Not revivals     : ${stats.revivalsNotDead} still alive before, ${stats.revivalsNotAncestor} not after the death, ${stats.revivalsDuplicate} same patch again`);
    console.log(`Merge artifacts  : ${stats.mergeArtifacts} (excluded from revivals)`);
    console.log(`Alive at HEAD    : ${stats.aliveAtHead} (${graveyard.stats.aliveAtHeadReverts} Reverts stay watched)`);
    console.log(`Output           : ${out}`);
  } catch (err) {
    if (err instanceof MinerError) {
      process.stderr.write(`deja-boo error: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
