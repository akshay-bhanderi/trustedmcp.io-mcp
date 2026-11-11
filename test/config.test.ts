import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entriesFrom, expandPath, knownConfigFiles, parseJsonc, readConfigFile } from '../src/config.js';

describe('parseJsonc', () => {
  it('accepts comments and trailing commas but keeps // inside strings', () => {
    const parsed = parseJsonc(`{
      // a comment
      "servers": { "x": { "url": "https://a.example/mcp", }, }, /* block */
    }`);
    expect(parsed).toEqual({ servers: { x: { url: 'https://a.example/mcp' } } });
  });

  it('says what is wrong with broken JSON', () => {
    expect(() => parseJsonc('{ nope')).toThrow(/Not valid JSON/);
  });
});

describe('entriesFrom', () => {
  it('reads every client format and never keeps env, headers or other arguments', () => {
    const claude = {
      mcpServers: {
        github: { command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_TOKEN=ghp_SECRET1', 'ghcr.io/github/github-mcp-server'], env: { GITHUB_TOKEN: 'ghp_SECRET2' } },
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/private'] },
        notion: { url: 'https://mcp.notion.com/mcp?api_key=SECRET3', headers: { Authorization: 'Bearer SECRET4' } },
        local: { command: 'node', args: ['/Users/me/tool/index.js', '--token', 'SECRET5'] },
        dev: { url: 'http://localhost:8080/mcp' },
      },
      projects: { '/Users/me/app': { mcpServers: { pw: { command: 'npx', args: ['@playwright/mcp@latest'] } } }, '/Users/me/empty': { mcpServers: {} } },
    };
    const entries = entriesFrom(claude, '~/.claude.json');

    expect(entries.map((e) => [e.name, e.identifiers])).toEqual([
      ['github', ['oci:ghcr.io/github/github-mcp-server']],
      ['fs', ['npm:@modelcontextprotocol/server-filesystem']],
      ['notion', ['remote:mcp.notion.com/mcp']],
      ['local', []],
      ['dev', []],
      ['pw', ['npm:@playwright/mcp']],
    ]);
    expect(entries.at(-1)?.source).toBe('~/.claude.json (project /Users/me/app)');
    expect(entries.find((e) => e.name === 'dev')?.runs).toBe('a local URL');
    expect(JSON.stringify(entries.map((e) => e.identifiers))).not.toMatch(/SECRET|private|Users/);
  });

  it('reads VS Code mcp.json, VS Code settings and Windsurf serverUrl', () => {
    expect(entriesFrom({ servers: { a: { type: 'http', url: 'https://mcp.stripe.com' } } }, 'mcp.json')[0]?.identifiers).toEqual(['remote:mcp.stripe.com']);
    expect(entriesFrom({ mcp: { servers: { b: { command: 'uvx', args: ['mcp-server-fetch'] } } } }, 'settings.json')[0]?.identifiers).toEqual(['pypi:mcp-server-fetch']);
    expect(entriesFrom({ mcpServers: { c: { serverUrl: 'https://mcp.example.com/sse' } } }, 'mcp_config.json')[0]?.identifiers).toEqual(['remote:mcp.example.com/sse']);
    expect(entriesFrom([1, 2], 'x.json')).toEqual([]);
  });
});

describe('files', () => {
  it('lists the known config paths per OS', () => {
    const win = knownConfigFiles({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u', 'C:\\proj').map((f) => f.path);
    expect(win).toContain(join('C:\\Users\\u\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'));
    expect(win).toContain(join('C:\\proj', '.vscode', 'mcp.json'));
    const mac = knownConfigFiles({}, 'darwin', '/Users/u', '/Users/u').map((f) => f.path);
    expect(mac).toContain(join('/Users/u', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
    expect(new Set(mac).size).toBe(mac.length);
  });

  it('reads only .json/.jsonc files and expands ~', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmcp-'));
    const file = join(dir, 'mcp.json');
    writeFileSync(file, '{ "mcpServers": {} }');
    expect(readConfigFile(file)).toEqual({ mcpServers: {} });
    expect(() => readConfigFile(join(dir, 'id_rsa'))).toThrow(/Only .json/);
    expect(() => readConfigFile(join(dir, 'missing.json'))).toThrow(/No file/);
    expect(expandPath('~/x.json', '/home/u', '/cwd')).toMatch(/home[\\/]u[\\/]x\.json$/);
    expect(expandPath('rel.json', '/home/u', '/cwd')).toMatch(/cwd[\\/]rel\.json$/);
  });
});
