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

  it('power bundle files have the agreed shape', () => {
    const plugin = json('power/plugin.json') as { name: string; version: string };
    expect([plugin.name, plugin.version]).toEqual(['deja-boo', '0.1.0']);
    expect(json('power/mcp.json')).toMatchObject({ mcpServers: { 'deja-boo': { type: 'stdio', command: 'npx', args: ['-y', 'github:rose050505/deja-boo', 'mcp'] } } });
    const guard = json('power/hooks/deja-boo-guard.json') as { hooks: { trigger: string; action: { command: string } }[] };
    expect(guard.hooks.map(h => h.trigger)).toEqual(['PreToolUse', 'Stop']);
    for (const h of guard.hooks) expect(h.action.command).toBe('npx -y github:rose050505/deja-boo hook');
    expect(readFileSync(root + 'power/skills/check-before-resurrecting/SKILL.md', 'utf8')).toMatch(/^---\nname: check-before-resurrecting\ndescription: .+\n---/);
  });

  it('agent and hooks are valid JSON with the requested triggers', () => {
    expect(json('.kiro/agents/graveyard-keeper.json')).toMatchObject({ tools: ['read', 'shell', '@deja-boo'], includeMcpJson: true });
    expect(json('.kiro/hooks/test-on-save.json')).toMatchObject({ hooks: [{ trigger: 'PostFileSave', matcher: '^src/.*\\.ts$' }] });
    expect(json('.kiro/hooks/session-brief.json')).toMatchObject({ hooks: [{ trigger: 'SessionStart' }] });
  });
});
