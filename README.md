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

## Install

Needs Node.js 18 or later.

**Claude Code**

```sh
claude mcp add trustedmcp -- npx -y trustedmcp mcp
```

**Claude Desktop, Cursor, Windsurf** (`claude_desktop_config.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "trustedmcp": {
      "command": "npx",
      "args": ["-y", "trustedmcp", "mcp"]
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
      "args": ["-y", "trustedmcp", "mcp"]
    }
  }
}
```

Then ask: *"Check my MCP config with TrustedMCP"*, or *"What grade does @playwright/mcp get, and is there something better?"*

## What leaves your machine

`check_config` reads your config file on your machine. It sends TrustedMCP only:

- each server's name in your config, and
- the package names (`npm:@playwright/mcp`), image names (`oci:ghcr.io/github/github-mcp-server`) and server URLs it found, without query strings.

Environment variables, headers, tokens, other arguments and file paths stay on your machine. A server that runs a local file (`node ./server.js`) is not sent at all; the tool tells you it can't be looked up. The API doesn't store what it receives. The code that builds those identifiers is in [`src/identifiers.ts`](src/identifiers.ts) and [`src/config.ts`](src/config.ts).

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `TRUSTEDMCP_API_KEY` | none | Optional free key from [trustedmcp.io/developers](https://trustedmcp.io/developers). Raises the limit from 30 to 300 requests a minute. |
| `TRUSTEDMCP_API_URL` | `https://trustedmcp.io/api/v1` | API base URL, for testing against another copy. |

With a key:

```json
{
  "mcpServers": {
    "trustedmcp": {
      "command": "npx",
      "args": ["-y", "trustedmcp", "mcp"],
      "env": { "TRUSTEDMCP_API_KEY": "tmcp_your_key" }
    }
  }
}
```

## The API

The server is a thin client for the free TrustedMCP JSON API (`https://trustedmcp.io/api/v1`: `/servers`, `/servers/{slug}`, `/lookup`, `/check`, `/registry/{name}`, `/categories`). Docs and terms: [trustedmcp.io/developers](https://trustedmcp.io/developers). Where you show a grade, credit "Grades by TrustedMCP" and link to the server's page.

## Develop

```sh
npm install
npm test        # vitest
npm run build   # tsc to dist/
TRUSTEDMCP_API_URL=http://127.0.0.1:8000/api/v1 node dist/cli.js mcp
```

Release (maintainers): bump `version` in `package.json` and `server.json`, `npm publish`, then `node scripts/publish-registry.mjs` to publish the same version to the official MCP Registry. That script needs the domain key for `io.trustedmcp/*`; it never leaves the maintainer's machine.

Use it as a library:

```ts
import { createServer, TrustedMcpApi } from 'trustedmcp';
```

## Missing a server?

If a server you use has no grade, [ask for one](https://trustedmcp.io/submit).

## License

MIT
