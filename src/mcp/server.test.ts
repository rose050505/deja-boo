import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fingerprintLines } from '../core/match.js';
import { toGraveyardJson } from '../miner/serialize.js';
import type { Graveyard, Tombstone } from '../core/types.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVER = join(ROOT, 'dist/mcp/server.js');
const lines = Array.from({ length: 10 }, (_, i) => `  const v${i} = fn${i}(arg${i}, ${i * 7}, opts.k);`);
const ID = 'a'.repeat(40);
const tombstone: Tombstone = {
  id: ID, fingerprint: fingerprintLines(lines), lines, path: 'src/a.ts', language: 'typescript',
  buriedAt: '2026-03-02T00:00:00Z', buriedAtTimestamp: 1772409600, commit: 'c'.repeat(40), author: 'x@y',
  causeOfDeath: 'leaked memory (PR #42)', links: [{ type: 'pr', ref: '42' }], revivals: [], deaths: [],
};
const graveyard: Graveyard = { tombstones: [tombstone], stats: {} as Graveyard['stats'] };

async function connect(cwd: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd, stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}
const text = (r: unknown): string => ((r as { content: { text: string }[] }).content[0] as { text: string }).text;

describe('MCP server over stdio', () => {
  let dir: string;
  beforeAll(() => {
    execFileSync('npx', ['tsc', '--project', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' });
    dir = mkdtempSync(join(tmpdir(), 'deja-boo-mcp-'));
    mkdirSync(join(dir, 'with/.deja-boo'), { recursive: true });
    mkdirSync(join(dir, 'without'));
    writeFileSync(join(dir, 'with/.deja-boo/graveyard.json'), toGraveyardJson(graveyard));
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the three tools and answers each one', async () => {
    const { client } = await connect(join(dir, 'with'));
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(t => t.name).sort()).toEqual(['check_snippet', 'get_tombstone', 'list_graveyard']);

      const check = await client.callTool({ name: 'check_snippet', arguments: { code: ['// new', ...lines].join('\n'), path: 'src/new.ts' } });
      expect(check.isError).toBeFalsy();
      const parsed = JSON.parse(text(check));
      expect(parsed.level).toBe('block');
      expect(parsed.revenants[0]).toMatchObject({ id: ID, matchedLines: [2, 11], causeOfDeath: 'leaked memory (PR #42)', commit: 'c'.repeat(40) });

      const got = await client.callTool({ name: 'get_tombstone', arguments: { id: ID } });
      expect(JSON.parse(text(got))).toMatchObject({ id: ID, lines, aliveAtHead: false });

      const missing = await client.callTool({ name: 'get_tombstone', arguments: { id: 'nope' } });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toBe('no tombstone with id nope');

      const list = await client.callTool({ name: 'list_graveyard', arguments: { limit: 5, path: 'src' } });
      expect(JSON.parse(text(list))).toEqual([expect.objectContaining({ id: ID, lineCount: 10 })]);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('without a graveyard every tool returns an error with the how-to', async () => {
    const { client } = await connect(join(dir, 'without'));
    try {
      const r = await client.callTool({ name: 'list_graveyard', arguments: {} });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain('deja-boo index . --out .deja-boo/graveyard.json');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('stdout carries only protocol frames', () => {
    // Raw run: initialize, then close stdin. Every stdout line must be JSON-RPC.
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    const out = execFileSync(process.execPath, [SERVER], { cwd: join(dir, 'without'), input: init + '\n', stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    const frames = out.split('\n').filter(l => l.trim() !== '');
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(JSON.parse(f)).toMatchObject({ jsonrpc: '2.0' });
  }, 30_000);
});
