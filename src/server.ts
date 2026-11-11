import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError, packageVersion, TrustedMcpApi, type CheckResult } from './api.js';
import {
  CLIENTS,
  CLIENT_NAMES,
  entriesFrom,
  expandPath,
  knownConfigFiles,
  parseJsonc,
  readConfigFile,
  type ConfigEntry,
  type ConfigFile,
} from './config.js';
import { existsSync } from 'node:fs';
import { GRADE_NOTE, REQUEST_REVIEW, registryBlock, registryLine, serverBlock, serverLine } from './format.js';

export { TrustedMcpApi } from './api.js';

const INSTRUCTIONS = `TrustedMCP grades MCP servers A to D from public signals: login, upkeep, known CVEs and how the server connects.
Use lookup_server when the user asks about one MCP server; check_config to review every server in their MCP setup (call it with no arguments to scan the usual config files); find_alternatives for better-graded servers; registry_lookup for an official MCP Registry entry and its reported security issues.
Present a grade as an assessment from public signals and a starting point for the user's own review, never as proof that a server is safe.`;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] };
}

function failure(e: unknown): ToolResult {
  let message = e instanceof Error ? e.message : String(e);
  if (e instanceof ApiError && e.status === 429) {
    message += e.retryAfter ? ` Try again in ${e.retryAfter} seconds.` : '';
  }
  return { content: [{ type: 'text', text: message }], isError: true };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const GRADE = z.enum(['A', 'B', 'C', 'D']);

/** Creates the TrustedMCP MCP server. Pass `api` to point it elsewhere (tests, a local API). */
export function createServer(options: { api?: TrustedMcpApi } = {}): McpServer {
  const api = options.api ?? new TrustedMcpApi();
  const server = new McpServer({ name: 'trustedmcp', title: 'TrustedMCP', version: packageVersion() }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'lookup_server',
    {
      title: 'Look up an MCP server',
      description:
        "Get an MCP server's TrustedMCP grade (A-D) by name, npm or PyPI package, Docker image, server URL, GitHub repo or launch command (e.g. 'npx -y @playwright/mcp'). Returns the four checks (login, upkeep, known bugs, connection), what to fix first and the TrustedMCP page. For servers without a grade, returns matching official MCP Registry entries.",
      inputSchema: {
        query: z.string().min(1).max(300).describe("Name, package, image, URL, repo or command, e.g. 'notion', '@playwright/mcp', 'https://mcp.stripe.com'"),
      },
      annotations: { title: 'Look up an MCP server', ...READ_ONLY },
    },
    async ({ query }) => {
      try {
        const { data } = await api.lookup(query);
        const [top, ...others] = data.graded;
        if (!top) {
          if (data.registry.length === 0) {
            return text(
              `No MCP server matches "${query}" in TrustedMCP or the official MCP Registry. Try a package name, a server URL or the repo URL. To ask for a grade: ${REQUEST_REVIEW}`,
            );
          }
          return text(
            [`TrustedMCP has no grade for "${query}" yet. Official MCP Registry entries that match:`, ...data.registry.map(registryLine), '', `Use registry_lookup for an entry's reported issues. To ask for a grade: ${REQUEST_REVIEW}`].join('\n'),
          );
        }
        // C and D servers get their same-category alternatives from the detail endpoint.
        const main = top.grade === 'C' || top.grade === 'D' ? (await api.server(top.slug)).data : top;
        const parts = [serverBlock(main)];
        if (others.length) parts.push(['Other graded matches:', ...others.map((s) => serverLine(s))].join('\n'));
        const unlinked = data.registry.filter((r) => !r.graded_listing);
        if (unlinked.length) parts.push(['Official MCP Registry entries that also match:', ...unlinked.map(registryLine)].join('\n'));
        parts.push(GRADE_NOTE);
        return text(parts.join('\n\n'));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'check_config',
    {
      title: 'Check an MCP config',
      description:
        'Grade every MCP server in an MCP config. With no arguments, reads the usual config files on this machine (Claude Desktop, Claude Code, Cursor, VS Code, Windsurf). Or pass `client` for one app, `path` for one file, or `config` with the JSON text. The file is read locally; only package names, image names and server URLs (no query strings) are sent to TrustedMCP. Env vars, headers, tokens and file paths never leave the machine.',
      inputSchema: {
        client: z.enum(CLIENTS).optional().describe('Only this app: claude_desktop, claude_code, cursor, vscode or windsurf'),
        path: z.string().max(1000).optional().describe('Path to one .json or .jsonc MCP config file'),
        config: z.string().max(2_000_000).optional().describe('The config JSON itself, e.g. the contents of claude_desktop_config.json'),
      },
      annotations: { title: 'Check an MCP config', ...READ_ONLY },
    },
    async ({ client, path, config }) => {
      try {
        const entries: ConfigEntry[] = [];
        const problems: string[] = [];
        const read: string[] = [];

        if (config !== undefined) {
          entries.push(...entriesFrom(parseJsonc(config), 'pasted config'));
          read.push('pasted config');
        } else {
          const files: ConfigFile[] = path
            ? [{ path: expandPath(path) }]
            : knownConfigFiles().filter((f) => (!client || f.client === client) && existsSync(f.path));
          if (files.length === 0) {
            const where = client ? CLIENT_NAMES[client] : 'Claude Desktop, Claude Code, Cursor, VS Code or Windsurf';
            return text(`No ${where} MCP config file found on this machine. Pass \`path\` to a config file, or \`config\` with its JSON.`);
          }
          for (const f of files) {
            try {
              const found = entriesFrom(readConfigFile(f.path), f.path);
              read.push(f.path);
              entries.push(...found);
            } catch (e) {
              problems.push(`- ${f.path}: ${(e as Error).message}`);
            }
          }
        }

        if (entries.length === 0) {
          return text([`No MCP servers found in ${read.length ? read.join(', ') : 'the config'}.`, ...problems].join('\n'));
        }

        const matchable = entries.filter((e) => e.identifiers.length > 0);
        const results = new Map<ConfigEntry, CheckResult>();
        for (let i = 0; i < matchable.length; i += 50) {
          const batch = matchable.slice(i, i + 50);
          const { data } = await api.check(batch.map((e) => ({ name: e.name, identifiers: e.identifiers })));
          batch.forEach((e, j) => {
            const r = data[j];
            if (r) results.set(e, r);
          });
        }

        const grades = { A: 0, B: 0, C: 0, D: 0 };
        let registryOnly = 0;
        let unknown = 0;
        const bySource = new Map<string, string[]>();
        for (const e of entries) {
          const r = results.get(e);
          let line: string;
          if (r?.server) {
            grades[r.server.grade]++;
            const fix = r.server.fix_first ? ` Fix first: ${r.server.fix_first}` : ' All four checks at full marks.';
            const alts = r.server.alternatives.length ? ` Better graded in its category: ${r.server.alternatives.map((a) => `${a.name} (${a.grade})`).join(', ')}.` : '';
            line = `- **${e.name}**: grade **${r.server.grade}**, ${r.server.name}.${fix}${alts} ${r.server.url}`;
          } else if (r?.registry) {
            registryOnly++;
            line = `- **${e.name}**: no TrustedMCP grade. Official MCP Registry entry \`${r.registry.name}\`: ${r.registry.reported_issues ? `${r.registry.reported_issues} reported issue(s)${r.registry.listed_version_affected ? ', listed version affected' : ''}` : 'no reported issues'}. ${r.registry.url}`;
          } else {
            unknown++;
            line = e.identifiers.length
              ? `- **${e.name}**: not found (${e.identifiers.join(', ')}). Review it yourself.`
              : `- **${e.name}**: runs ${e.runs === 'a local URL' || e.runs === 'a remote URL' ? e.runs : `\`${e.runs}\` with a local file or a name we can't match`}, so it can't be looked up. Review it yourself.`;
          }
          const list = bySource.get(e.source) ?? [];
          list.push(line);
          bySource.set(e.source, list);
        }

        const graded = grades.A + grades.B + grades.C + grades.D;
        const gradeText = (Object.entries(grades) as Array<[string, number]>).filter(([, n]) => n > 0).map(([g, n]) => `${g} ${n}`).join(', ');
        const out = [
          `Checked ${entries.length} MCP server${entries.length === 1 ? '' : 's'} in ${read.length} config${read.length === 1 ? '' : 's'}: ${graded} graded${gradeText ? ` (${gradeText})` : ''}, ${registryOnly} only in the official registry, ${unknown} not found.`,
        ];
        for (const [source, lines] of bySource) out.push('', `### ${source}`, ...lines);
        if (problems.length) out.push('', 'Could not read:', ...problems);
        out.push('', GRADE_NOTE);
        if (registryOnly + unknown > 0) out.push(`To ask for a grade: ${REQUEST_REVIEW}`);
        return text(out.join('\n'));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'find_alternatives',
    {
      title: 'Find graded MCP servers',
      description:
        "List TrustedMCP-graded MCP servers, best grade first. Filter by category ('databases', 'browser automation'), a search term, or the minimum grade; or pass `instead_of` with a server name or package to get better-graded servers in its category.",
      inputSchema: {
        instead_of: z.string().max(300).optional().describe('A server to replace: name, slug, package or URL'),
        category: z.string().max(100).optional().describe('Category name or slug'),
        query: z.string().max(100).optional().describe('Search term matched against name, vendor and summary'),
        min_grade: GRADE.default('B').describe('Lowest grade to include (default B)'),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { title: 'Find graded MCP servers', ...READ_ONLY },
    },
    async ({ instead_of, category, query, min_grade, limit }) => {
      try {
        let categorySlug: string | undefined;
        let exclude: string | undefined;
        let intro = '';

        if (instead_of) {
          const top = (await api.lookup(instead_of)).data.graded[0];
          if (!top?.category) {
            return text(`TrustedMCP has no graded server matching "${instead_of}", so its category is unknown. Pass \`category\` instead.`);
          }
          categorySlug = top.category.slug;
          exclude = top.slug;
          intro = `${top.name} is graded ${top.grade}, in ${top.category.name}. `;
        } else if (category) {
          const cats = (await api.categories()).data;
          const want = category.trim().toLowerCase();
          const match =
            cats.find((c) => c.slug === want || c.name.toLowerCase() === want) ??
            cats.find((c) => c.name.toLowerCase().includes(want) || c.slug.includes(want.replace(/\s+/g, '-')));
          if (!match) {
            return text([`No category matches "${category}". Categories with graded servers:`, ...cats.map((c) => `- ${c.name} (\`${c.slug}\`, ${c.graded_servers})`)].join('\n'));
          }
          categorySlug = match.slug;
        }

        const { data, meta } = await api.servers({ category: categorySlug, q: query, min_grade, limit: limit + (exclude ? 1 : 0) });
        const list = data.filter((s) => s.slug !== exclude).slice(0, limit);
        if (list.length === 0) {
          return text(`${intro}No graded servers at ${min_grade} or better match. Try a lower min_grade or another category.`);
        }
        const total = meta.total - (exclude && data.some((s) => s.slug === exclude) ? 1 : 0);
        return text(
          [`${intro}${total} graded server${total === 1 ? '' : 's'} at ${min_grade} or better${categorySlug ? ` in ${list[0]?.category?.name ?? categorySlug}` : ''}${query ? ` matching "${query}"` : ''}; top ${list.length}:`, ...list.map((s, i) => serverLine(s, i + 1)), '', GRADE_NOTE].join('\n'),
        );
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'registry_lookup',
    {
      title: 'Official MCP Registry entry',
      description:
        "Get an official MCP Registry entry ('io.github.owner/repo') with its packages, remotes, TrustedMCP grade if any, and reported security issues (GHSA/CVE advisories, and whether the listed version is affected). Also accepts a package name or search term and picks the best matching entry.",
      inputSchema: {
        name: z.string().min(1).max(300).describe("Registry name like 'io.github.owner/repo', or a package name or search term"),
      },
      annotations: { title: 'Official MCP Registry entry', ...READ_ONLY },
    },
    async ({ name }) => {
      try {
        const wanted = name.trim();
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S+$/i.test(wanted)) {
          try {
            return text(registryBlock((await api.registry(wanted)).data));
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 404)) throw e;
          }
        }
        const { data } = await api.lookup(wanted);
        const [first, ...rest] = data.registry;
        if (!first) {
          return text(`No official MCP Registry entry matches "${wanted}". Registry names look like io.github.owner/repo.`);
        }
        const parts = [registryBlock((await api.registry(first.name)).data)];
        if (rest.length) parts.push(['Other matching entries:', ...rest.map(registryLine)].join('\n'));
        return text(parts.join('\n\n'));
      } catch (e) {
        return failure(e);
      }
    },
  );

  return server;
}
