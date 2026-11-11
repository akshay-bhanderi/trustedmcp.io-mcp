import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { fromCommand, remote } from './identifiers.js';

export const CLIENTS = ['claude_desktop', 'claude_code', 'cursor', 'vscode', 'windsurf'] as const;
export type Client = (typeof CLIENTS)[number];

export const CLIENT_NAMES: Record<Client, string> = {
  claude_desktop: 'Claude Desktop',
  claude_code: 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
};

/** One server entry from an MCP config. Only `name` and `identifiers` are ever sent. */
export interface ConfigEntry {
  name: string;
  /** Where it was found: the file, plus a scope for Claude Code's per-project lists. */
  source: string;
  /** "npm:...", "oci:...", "remote:...": built locally, see identifiers.ts. */
  identifiers: string[];
  /** Shown to the user when nothing can be matched, e.g. "node" or "a local URL". */
  runs: string;
}

export interface ConfigFile {
  path: string;
  client?: Client;
}

/** Biggest config we read. ~/.claude.json holds history too, so it can be a few MB. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Known config locations per client, for this OS, home and working directory. */
export function knownConfigFiles(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  cwd: string = process.cwd(),
): ConfigFile[] {
  const appData =
    platform === 'win32'
      ? env.APPDATA ?? join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : env.XDG_CONFIG_HOME ?? join(home, '.config');

  const files: ConfigFile[] = [
    { client: 'claude_desktop', path: join(appData, 'Claude', 'claude_desktop_config.json') },
    { client: 'claude_code', path: join(home, '.claude.json') },
    { client: 'claude_code', path: join(cwd, '.mcp.json') },
    { client: 'cursor', path: join(home, '.cursor', 'mcp.json') },
    { client: 'cursor', path: join(cwd, '.cursor', 'mcp.json') },
    { client: 'vscode', path: join(appData, 'Code', 'User', 'mcp.json') },
    { client: 'vscode', path: join(appData, 'Code', 'User', 'settings.json') },
    { client: 'vscode', path: join(cwd, '.vscode', 'mcp.json') },
    { client: 'windsurf', path: join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  ];
  // The working directory can be the home directory; don't list a file twice.
  const seen = new Set<string>();
  return files.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
}

/** Expands ~ and resolves against the working directory. */
export function expandPath(path: string, home: string = homedir(), cwd: string = process.cwd()): string {
  const p = path.trim().replace(/^~(?=$|[\\/])/, home);
  return isAbsolute(p) ? p : resolve(cwd, p);
}

/** Reads a config file; throws a short, user-facing Error when it can't. */
export function readConfigFile(path: string): unknown {
  const ext = extname(path).toLowerCase();
  if (ext !== '.json' && ext !== '.jsonc') {
    throw new Error(`Only .json or .jsonc config files are read, not ${path}.`);
  }
  if (!existsSync(path)) throw new Error(`No file at ${path}.`);
  if (statSync(path).size > MAX_BYTES) throw new Error(`${path} is larger than 25 MB; not read.`);
  return parseJsonc(readFileSync(path, 'utf8'));
}

/** JSON with comments and trailing commas (VS Code and Cursor allow both). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += ch;
    }
  }
  out = out.replace(/,(\s*[}\]])/g, '$1').replace(/^﻿/, '');
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
}

type ServerMap = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The server maps inside a parsed config, labelled by scope. */
function serverMaps(config: unknown): Array<{ scope: string; servers: ServerMap }> {
  if (!isObject(config)) return [];
  const maps: Array<{ scope: string; servers: ServerMap }> = [];
  // Claude Desktop, Claude Code (.mcp.json, ~/.claude.json user scope), Cursor, Windsurf.
  if (isObject(config.mcpServers)) maps.push({ scope: '', servers: config.mcpServers });
  // VS Code mcp.json.
  if (isObject(config.servers)) maps.push({ scope: '', servers: config.servers });
  // VS Code settings.json: "mcp": { "servers": {...} }.
  if (isObject(config.mcp) && isObject(config.mcp.servers)) maps.push({ scope: 'settings "mcp"', servers: config.mcp.servers });
  // ~/.claude.json local scope: "projects": { "/path": { "mcpServers": {...} } }.
  if (isObject(config.projects)) {
    for (const [project, value] of Object.entries(config.projects)) {
      if (isObject(value) && isObject(value.mcpServers) && Object.keys(value.mcpServers).length > 0) {
        maps.push({ scope: `project ${project}`, servers: value.mcpServers });
      }
    }
  }
  return maps;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Every server entry in a parsed config, with identifiers built locally. */
export function entriesFrom(config: unknown, path: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  for (const { scope, servers } of serverMaps(config)) {
    for (const [name, raw] of Object.entries(servers)) {
      if (!isObject(raw)) continue;
      const source = scope ? `${path} (${scope})` : path;
      const url = [raw.url, raw.serverUrl, raw.httpUrl].find((u): u is string => typeof u === 'string');
      if (url) {
        const id = remote(url);
        const local = id !== null && /^remote:(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(id);
        entries.push({ name, source, identifiers: id && !local ? [id] : [], runs: local ? 'a local URL' : 'a remote URL' });
        continue;
      }
      if (typeof raw.command === 'string') {
        const ids = fromCommand(raw.command, strings(raw.args));
        const cmd = raw.command.replace(/\\/g, '/').split('/').pop() ?? raw.command;
        entries.push({ name, source, identifiers: ids, runs: cmd });
      }
    }
  }
  return entries;
}
