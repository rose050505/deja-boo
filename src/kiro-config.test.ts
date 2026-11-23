import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THRESHOLDS, loadConfig } from './watch/load.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = (rel: string): unknown => JSON.parse(readFileSync(root + rel, 'utf8'));

describe('dogfood files (REQ-7)', () => {
  it('hook file guards write tools with the hook command', () => {
    expect(json('.kiro/hooks/deja-boo-guard.json')).toEqual({
      version: 'v1',
      hooks: [
        { name: 'deja-boo-guard', trigger: 'PreToolUse', matcher: 'write', action: { type: 'command', command: 'node dist/cli/main.js hook' } },
        { name: 'deja-boo-stop-guard', trigger: 'Stop', action: { type: 'command', command: 'node dist/cli/main.js hook' } },
      ],
    });
  });

  it('MCP file registers the deja-boo server with the three tools auto-approved', () => {
    expect(json('.kiro/settings/mcp.json')).toEqual({
      mcpServers: { 'deja-boo': { command: 'node', args: ['dist/mcp/server.js'], disabled: false, autoApprove: ['check_snippet', 'get_tombstone', 'list_graveyard'] } },
    });
  });

  it('config.json holds the default thresholds and loads without notes', () => {
    const { config, notes } = loadConfig(root);
    expect(notes).toEqual([]);
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(json('.deja-boo/config.json')).toEqual({ thresholds: DEFAULT_THRESHOLDS });
  });

  it('.gitignore ignores the graveyard but never .kiro/', () => {
    const lines = readFileSync(root + '.gitignore', 'utf8').split('\n').map(l => l.trim());
    expect(lines).toContain('.deja-boo/graveyard.json');
    expect(lines.filter(l => !l.startsWith('#')).some(l => /^\/?\.kiro\/?\*?$/.test(l))).toBe(false);
  });
});
