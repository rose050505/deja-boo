#!/usr/bin/env node
/**
 * Déjà Boo MCP server (stdio). Tools: check_snippet, get_tombstone, list_graveyard.
 * stdout carries only MCP protocol frames; diagnostics go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, loadGraveyard } from '../watch/load.js';
import { checkSnippet, getTombstone, listGraveyard, ToolError } from './tools.js';

const HOWTO = 'no graveyard at .deja-boo/graveyard.json. Create it with: deja-boo index . --out .deja-boo/graveyard.json';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

const cwd = process.cwd();
const graveyard = loadGraveyard(cwd);
if (!graveyard) process.stderr.write(`deja-boo mcp: ${HOWTO}\n`);

/** Run a handler against the graveyard; ToolError and a missing graveyard become MCP error results. */
function run(fn: (g: NonNullable<typeof graveyard>) => unknown): ToolResult {
  if (!graveyard) return fail(HOWTO);
  try {
    return ok(fn(graveyard));
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    throw err;
  }
}

const server = new McpServer({ name: 'deja-boo', version: '0.1.0' });

server.registerTool('check_snippet', {
  description: 'Check code against the graveyard of deliberately deleted code. Returns the level (none, warn, block) and each matching tombstone with its commit, date and cause of death.',
  inputSchema: { code: z.string(), path: z.string().optional() },
}, ({ code, path }) => run(g => {
  const { config, notes } = loadConfig(cwd);
  for (const n of notes) process.stderr.write(`deja-boo mcp: ${n}\n`);
  return checkSnippet(g, config.thresholds, code, path);
}));

server.registerTool('get_tombstone', {
  description: 'Read one tombstone in full: deleted lines, commit, date, cause of death, links, revivals and deaths.',
  inputSchema: { id: z.string() },
}, ({ id }) => run(g => getTombstone(g, id)));

server.registerTool('list_graveyard', {
  description: 'List tombstone summaries, newest first. `limit` defaults to 20 (max 100); `path` keeps one file or directory.',
  inputSchema: { limit: z.number().int().optional(), path: z.string().optional() },
}, ({ limit, path }) => run(g => listGraveyard(g, { limit, path })));

await server.connect(new StdioServerTransport());
