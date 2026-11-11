import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { TrustedMcpApi } from '../src/api.js';
import { createServer } from '../src/server.js';

const checks = [
  { check: 'Login', state: 'part', note: 'login required, broad access' },
  { check: 'Upkeep', state: 'full', note: 'actively maintained' },
  { check: 'Known bugs', state: 'full', note: '0 open' },
  { check: 'Connection', state: 'full', note: 'remote over HTTPS' },
];
const summary = (slug: string, grade: string, extra: Record<string, unknown> = {}) => ({
  slug, name: slug.toUpperCase(), vendor: 'Acme', summary: null, category: { slug: 'dev-tools', name: 'Developer tools' },
  grade, checks, checks_at_full_marks: 3, fix_first: grade === 'A' ? null : 'Pin a version.', known_cves: 0,
  maintainer_activity: 'active', last_updated: '2026-10-01', repo_url: null,
  url: `https://trustedmcp.io/servers/${slug}`, badge_url: `https://trustedmcp.io/badge/${slug}.svg`, ...extra,
});
const detail = (slug: string, grade: string, alternatives: unknown[] = []) => ({
  ...summary(slug, grade), auth_support: 'yes', auth_note: null, transport: 'stdio', homepage_url: null, alternatives, registry: [],
});
const registryEntry = {
  name: 'io.github.acme/thing', title: 'Thing', description: 'A thing.', status: 'active', version: '1.2.0', runs_as: ['npm'],
  repo_url: null, website_url: null, reported_issues: 1, listed_version_affected: true, graded_listing: null,
  url: 'https://trustedmcp.io/registry/io.github.acme/thing',
};
const meta = { note: 'public signals', docs: 'https://trustedmcp.io/developers' };

type Call = { url: string; method: string; body?: string; headers: Record<string, string> };

/** A fake API: routes by path, records every call. */
function fakeApi(routes: Record<string, (body?: string) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined, headers: init?.headers as Record<string, string> });
    const path = url.replace('https://api.test/v1', '');
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(`${k}?`));
    const r = key ? routes[key]!(init?.body as string | undefined) : { status: 404, json: { error: { code: 'not_found', message: 'No such thing.' } } };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { api: new TrustedMcpApi({ baseUrl: 'https://api.test/v1', apiKey: 'tmcp_test', fetch: fetchImpl }), calls };
}

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(api: TrustedMcpApi) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ api }).connect(a);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
  return client;
}

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const res = (await c.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: res.content.map((x) => x.text).join('\n'), isError: res.isError ?? false };
}

describe('tools', () => {
  it('lists four read-only tools', async () => {
    const c = await connect(fakeApi({}).api);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_config', 'find_alternatives', 'lookup_server', 'registry_lookup']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('lookup_server shows the grade, the checks and alternatives for a C', async () => {
    const { api, calls } = fakeApi({
      '/lookup': () => ({ json: { data: { query: 'x', identifiers: [], graded: [summary('low-one', 'C')], registry: [registryEntry] }, meta } }),
      '/servers/low-one': () => ({ json: { data: detail('low-one', 'C', [{ slug: 'good-one', name: 'Good One', grade: 'A', url: 'https://trustedmcp.io/servers/good-one' }]), meta } }),
    });
    const c = await connect(api);
    const { text, isError } = await call(c, 'lookup_server', { query: '@acme/low-one' });

    expect(isError).toBe(false);
    expect(text).toContain('grade **C**');
    expect(text).toContain('- Login: part marks, login required, broad access');
    expect(text).toContain('Fix first: Pin a version.');
    expect(text).toContain('Good One (`good-one`): grade A');
    expect(text).toContain('io.github.acme/thing');
    expect(text).toContain('assessment from public signals');
    expect(calls[0]?.url).toBe('https://api.test/v1/lookup?q=%40acme%2Flow-one');
    expect(calls[0]?.headers.Authorization).toBe('Bearer tmcp_test');
  });

  it('lookup_server says when nothing is graded', async () => {
    const { api } = fakeApi({ '/lookup': () => ({ json: { data: { query: 'zzz', identifiers: [], graded: [], registry: [] }, meta } }) });
    const { text } = await call(await connect(api), 'lookup_server', { query: 'zzz' });
    expect(text).toContain('No MCP server matches "zzz"');
    expect(text).toContain('https://trustedmcp.io/submit');
  });

  it('check_config sends identifiers only and reports every entry', async () => {
    const { api, calls } = fakeApi({
      '/check': (body) => {
        const servers = JSON.parse(body ?? '{}').servers as Array<{ name: string }>;
        return {
          json: {
            data: servers.map((s) =>
              s.name === 'github'
                ? { name: s.name, identifiers: [], status: 'graded', matched_by: null, server: detail('github-mcp-server', 'A'), registry: null }
                : s.name === 'thing'
                  ? { name: s.name, identifiers: [], status: 'registry_only', matched_by: null, server: null, registry: registryEntry }
                  : { name: s.name, identifiers: [], status: 'unknown', matched_by: null, server: null, registry: null },
            ),
            meta: { ...meta, summary: {} },
          },
        };
      },
    });
    const config = JSON.stringify({
      mcpServers: {
        github: { command: 'docker', args: ['run', '-e', 'GITHUB_TOKEN=ghp_SECRET', 'ghcr.io/github/github-mcp-server'], env: { GITHUB_TOKEN: 'ghp_SECRET' } },
        thing: { command: 'npx', args: ['-y', '@acme/thing', '--api-key', 'sk_SECRET'] },
        mystery: { url: 'https://mcp.unknown.example/mcp?token=SECRET' },
        local: { command: 'node', args: ['C:\\Users\\me\\secret-project\\index.js'] },
      },
    });
    const { text, isError } = await call(await connect(api), 'check_config', { config });

    expect(isError).toBe(false);
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]!.body!);
    expect(sent).toEqual({
      servers: [
        { name: 'github', identifiers: ['oci:ghcr.io/github/github-mcp-server'] },
        { name: 'thing', identifiers: ['npm:@acme/thing'] },
        { name: 'mystery', identifiers: ['remote:mcp.unknown.example/mcp'] },
      ],
    });
    expect(calls[0]!.body).not.toMatch(/SECRET|secret-project|GITHUB_TOKEN/);
    expect(text).toContain('Checked 4 MCP servers in 1 config: 1 graded (A 1), 1 only in the official registry, 2 not found.');
    expect(text).toContain('- **github**: grade **A**');
    expect(text).toContain('- **thing**: no TrustedMCP grade. Official MCP Registry entry `io.github.acme/thing`: 1 reported issue(s), listed version affected.');
    expect(text).toContain('- **local**: runs `node` with a local file');
  });

  it('check_config refuses files that are not JSON', async () => {
    const { text } = await call(await connect(fakeApi({}).api), 'check_config', { path: '~/.ssh/id_rsa' });
    expect(text).toContain('Only .json or .jsonc');
  });

  it('find_alternatives resolves a category name and excludes the server being replaced', async () => {
    const { api, calls } = fakeApi({
      '/lookup': () => ({ json: { data: { query: 'x', identifiers: [], graded: [summary('low-one', 'C')], registry: [] }, meta } }),
      '/servers': () => ({ json: { data: [summary('good-one', 'A'), summary('low-one', 'C'), summary('ok-one', 'B')], meta: { ...meta, total: 3 } } }),
    });
    const { text } = await call(await connect(api), 'find_alternatives', { instead_of: 'low-one', limit: 2 });

    expect(calls[1]?.url).toBe('https://api.test/v1/servers?category=dev-tools&min_grade=B&limit=3');
    expect(text).toContain('LOW-ONE is graded C, in Developer tools.');
    expect(text).toContain('1. **GOOD-ONE**');
    expect(text).toContain('2. **OK-ONE**');
    expect(text).not.toContain('**LOW-ONE**');
  });

  it('find_alternatives lists categories when the name is unknown', async () => {
    const { api } = fakeApi({ '/categories': () => ({ json: { data: [{ slug: 'databases', name: 'Databases', graded_servers: 12 }], meta } }) });
    const { text } = await call(await connect(api), 'find_alternatives', { category: 'spaceships' });
    expect(text).toContain('No category matches "spaceships"');
    expect(text).toContain('- Databases (`databases`, 12)');
  });

  it('registry_lookup shows advisories and falls back to search', async () => {
    const full = { ...registryEntry, packages: [{ type: 'npm', identifier: '@acme/thing', version: '1.2.0' }], remotes: [], versions_tracked: 4,
      registry_updated_at: null, issues_checked_at: '2026-11-10T00:00:00Z',
      advisories: [{ id: 'GHSA-aaaa-bbbb-cccc', also_known_as: ['CVE-2026-1'], title: 'Path traversal', severity: 'high', listed_version: 'affected', published_at: '2026-10-01', url: 'https://osv.dev/x' }] };
    const { api, calls } = fakeApi({
      '/registry/io.github.acme/thing': () => ({ json: { data: full, meta } }),
      '/lookup': () => ({ json: { data: { query: 'thing', identifiers: [], graded: [], registry: [registryEntry] }, meta } }),
    });
    const c = await connect(api);

    const direct = await call(c, 'registry_lookup', { name: 'io.github.acme/thing' });
    expect(direct.text).toContain('- GHSA-aaaa-bbbb-cccc (also CVE-2026-1): Path traversal [high, listed version affected');
    expect(direct.text).toContain('TrustedMCP grade: none yet.');

    const searched = await call(c, 'registry_lookup', { name: 'thing' });
    expect(searched.text).toContain('Path traversal');
    expect(calls.map((x) => x.url.replace('https://api.test/v1', ''))).toEqual(['/registry/io.github.acme/thing', '/lookup?q=thing', '/registry/io.github.acme/thing']);
  });

  it('turns API errors into tool errors', async () => {
    const { api } = fakeApi({ '/lookup': () => ({ status: 429, json: { error: { code: 'rate_limited', message: 'Rate limit reached.' } } }) });
    const res = await call(await connect(api), 'lookup_server', { query: 'x' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Rate limit reached.');
  });
});

describe('API key', () => {
  const NO_KEY = "TrustedMCP needs a free API key for tool calls. Get one at https://trustedmcp.io/developers#key, then set TRUSTEDMCP_API_KEY in this server's env.";
  const withKey = (apiKey: string | undefined, handler: (url: string) => Response) => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string> });
      return handler(String(input));
    }) as typeof fetch;
    return { api: new TrustedMcpApi({ baseUrl: 'https://api.test/v1', apiKey, fetch: fetchImpl }), calls };
  };
  const configArgs = { config: '{"mcpServers":{"a":{"command":"npx","args":["-y","@acme/thing"]}}}' };
  const toolCalls: Array<[string, Record<string, unknown>]> = [
    ['lookup_server', { query: 'x' }],
    ['check_config', configArgs],
    ['find_alternatives', { category: 'databases' }],
    ['registry_lookup', { name: 'io.github.acme/thing' }],
  ];

  it.each(['', '   ', undefined])('without a key (%j) every tool returns isError and never calls fetch', async (k) => {
    const prev = process.env.TRUSTEDMCP_API_KEY;
    delete process.env.TRUSTEDMCP_API_KEY;
    try {
      const { api, calls } = withKey(k, () => new Response('{}'));
      const c = await connect(api);
      expect((await c.listTools()).tools).toHaveLength(4);
      for (const [name, args] of toolCalls) {
        const r = await call(c, name, args);
        expect(r.isError).toBe(true);
        expect(r.text).toBe(NO_KEY);
      }
      expect(calls).toHaveLength(0);
    } finally {
      if (prev !== undefined) process.env.TRUSTEDMCP_API_KEY = prev;
    }
  });

  it('mentions the key in the server instructions', async () => {
    const c = await connect(fakeApi({}).api);
    expect(c.getInstructions()).toContain('TRUSTEDMCP_API_KEY');
  });

  it('sends the key as a Bearer token', async () => {
    const body = { data: { query: 'x', identifiers: [], graded: [], registry: [] }, meta };
    const { api, calls } = withKey('tmcp_abc', () => new Response(JSON.stringify(body), { status: 200 }));
    const r = await call(await connect(api), 'lookup_server', { query: 'x' });
    expect(r.isError).toBe(false);
    expect(calls[0]!.headers.Authorization).toBe('Bearer tmcp_abc');
  });

  it('shows the message from a 403 insufficient_scope', async () => {
    const message = "This key doesn't have the config:check scope. Get a key with it at https://trustedmcp.io/developers#key.";
    const body = { error: 'insufficient_scope', required_scope: 'config:check', message };
    const { api } = withKey('tmcp_abc', () => new Response(JSON.stringify(body), { status: 403 }));
    const r = await call(await connect(api), 'check_config', configArgs);
    expect(r.isError).toBe(true);
    expect(r.text).toBe(message);
  });

  it('tells the user a 401 key was rejected and where to get a new one', async () => {
    const body = { error: { code: 'unauthorized', message: 'Bad key.' } };
    const { api } = withKey('tmcp_old', () => new Response(JSON.stringify(body), { status: 401 }));
    const r = await call(await connect(api), 'lookup_server', { query: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('rejected');
    expect(r.text).toContain('https://trustedmcp.io/developers#key');
  });
});
