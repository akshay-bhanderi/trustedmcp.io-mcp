# TrustedMCP MCP server

Give your agent the [TrustedMCP](https://trustedmcp.io) grades. Ask it "is this MCP server any good?" or "check my MCP setup", and it answers with an A to D grade per server, what to fix first, and better-graded servers in the same category.

Each grade is an assessment from public signals: login, upkeep, known CVEs and how the server connects. Use it as a starting point for your own review. It is not an audit of the code. [How we grade](https://trustedmcp.io/guides/how-trustedmcp-scores-servers).

## Tools

| Tool | What it does |
| --- | --- |
| `lookup_server` | One server by name, npm or PyPI package, Docker image, URL, GitHub repo or launch command: its grade, the four checks, what to fix first, its TrustedMCP page. |
| `check_config` | Every server in your MCP config. With no arguments it reads the usual config files for Claude Desktop, Claude Code, Cursor, VS Code and Windsurf. You can also pass one `client`, a `path` or the `config` JSON. |
| `find_alternatives` | Graded servers by category, search term or minimum grade. Or `instead_of` a server, for better-graded ones in its category. |
| `registry_lookup` | An official MCP Registry entry: packages, remotes, TrustedMCP grade if any, and reported security issues (GHSA/CVE, and whether the listed version is affected). |

All four tools only read data.

## Get a key

Tool calls need a free API key. Sign up with your email at [trustedmcp.io/developers](https://trustedmcp.io/developers#key). The server still starts and lists its tools without one, but every tool call returns an error that tells you to add a key.

Keys are scoped. A key can have any of these three scopes:

| Scope | Covers |
| --- | --- |
| `servers:read` | `lookup_server` and `find_alternatives` |
| `config:check` | `check_config` |
| `registry:read` | `registry_lookup` |

`registry_lookup` also falls back to a server search when you give it a package name or search term instead of a registry name, so give the key `servers:read` as well. If a key lacks the scope a tool needs, the tool says which scope is missing. You can revoke or rotate a key on the same page. A revoked or invalid key is rejected, and the tool tells you to get a new one.

## Install

**Hosted (no install)**

TrustedMCP also runs as a hosted server at `https://trustedmcp.io/mcp`. It has the same four tools. Nothing to install, no Node.js needed. Send your key as a Bearer token.

Claude Code:

```sh
claude mcp add --transport http trustedmcp https://trustedmcp.io/mcp --header "Authorization: Bearer YOUR_KEY"
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "trustedmcp": {
      "url": "https://trustedmcp.io/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "trustedmcp": {
      "type": "http",
      "url": "https://trustedmcp.io/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

The hosted server can't read files on your machine, so `check_config` needs your config pasted in as the `config` argument. The npx version below reads your config files locally.

**Run locally with npx**

Needs Node.js 18 or later.

**Claude Code**

```sh
claude mcp add trustedmcp -e TRUSTEDMCP_API_KEY=YOUR_KEY -- npx -y trustedmcp mcp
```

**Claude Desktop, Cursor, Windsurf** (`claude_desktop_config.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "trustedmcp": {
      "command": "npx",
      "args": ["-y", "trustedmcp", "mcp"],
      "env": { "TRUSTEDMCP_API_KEY": "YOUR_KEY" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "trustedmcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "trustedmcp", "mcp"],
      "env": { "TRUSTEDMCP_API_KEY": "YOUR_KEY" }
    }
  }
}
```

Then ask: *"Check my MCP config with TrustedMCP"*, or *"What grade does @playwright/mcp get, and is there something better?"*

## What leaves your machine

With the hosted endpoint, whatever you pass to a tool is sent to trustedmcp.io. The rest of this section is about the npx version.

`check_config` reads your config file on your machine. It sends TrustedMCP only:

- each server's name in your config, and
- the package names (`npm:@playwright/mcp`), image names (`oci:ghcr.io/github/github-mcp-server`) and server URLs it found, without query strings.

Environment variables, headers, tokens, other arguments and file paths stay on your machine. A server that runs a local file (`node ./server.js`) is not sent at all; the tool tells you it can't be looked up. The API doesn't store what it receives. The code that builds those identifiers is in [`src/identifiers.ts`](src/identifiers.ts) and [`src/config.ts`](src/config.ts).

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `TRUSTEDMCP_API_KEY` | none | Required for tool calls. Free key from [trustedmcp.io/developers](https://trustedmcp.io/developers#key), with the scopes `servers:read`, `config:check` and `registry:read`. |
| `TRUSTEDMCP_API_URL` | `https://trustedmcp.io/api/v1` | API base URL, for testing against another copy. |

## The API

The server is a thin client for the free TrustedMCP JSON API (`https://trustedmcp.io/api/v1`: `/servers`, `/servers/{slug}`, `/lookup`, `/check`, `/registry/{name}`, `/categories`). Docs and terms: [trustedmcp.io/developers](https://trustedmcp.io/developers). Where you show a grade, credit "Grades by TrustedMCP" and link to the server's page.

## Develop

```sh
npm install
npm test        # vitest
npm run build   # tsc to dist/
TRUSTEDMCP_API_URL=http://127.0.0.1:8000/api/v1 node dist/cli.js mcp
```

Tool calls need a key even when you point `TRUSTEDMCP_API_URL` at a local copy.

Release (maintainers): bump `version` in `package.json` and both `version` fields in `server.json` (top level and `packages[0]`), `npm publish`, then `node scripts/publish-registry.mjs` to publish the same version to the official MCP Registry. That script needs the domain key for `io.trustedmcp/*`; it never leaves the maintainer's machine.

Use it as a library:

```ts
import { createServer, TrustedMcpApi } from 'trustedmcp';
```

## Missing a server?

If a server you use has no grade, [ask for one](https://trustedmcp.io/submit).

## License

MIT
