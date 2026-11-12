# Installing the TrustedMCP MCP server

Steps for an AI agent (Cline and others) setting this server up for a user.

## What it is

A read-only MCP server with four tools: `lookup_server`, `check_config`, `find_alternatives` and `registry_lookup`. It looks up TrustedMCP's A to D grades for MCP servers. Each grade is an assessment from public signals, not an audit of the code.

## Prerequisites

- Node.js 18 or later (`node --version`).
- A free TrustedMCP API key. Tool calls need one. Ask the user for their key. If they don't have one, tell them to sign up with their email at https://trustedmcp.io/developers#key and give the key the scopes `servers:read`, `config:check` and `registry:read`. Without a key the server still starts and lists its tools, but every tool call returns an error that asks for a key.

Never write the key anywhere except the `env` block below, and never print it back to the user.

## Install

Nothing to clone or build. The server runs from npm with `npx`.

Add this entry to the `mcpServers` object in the MCP settings file. For Cline that is `cline_mcp_settings.json` (open it from the MCP Servers panel, "Configure MCP Servers"). Keep any servers already in the file.

```json
{
  "mcpServers": {
    "trustedmcp": {
      "command": "npx",
      "args": ["-y", "trustedmcp", "mcp"],
      "env": { "TRUSTEDMCP_API_KEY": "THE_USER'S_KEY" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

On Windows, if `npx` can't be found, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "trustedmcp", "mcp"]`.

## Check it works

1. The server should show as connected with four tools.
2. Call `lookup_server` with `{"query": "@playwright/mcp"}`. It should return a grade, the four checks and a link to the server's TrustedMCP page.

If the call says a key is missing, invalid or lacks a scope, ask the user to check the key at https://trustedmcp.io/developers#key.

## No install option

There is also a hosted server at `https://trustedmcp.io/mcp` (Streamable HTTP) with the same tools. Send the key as `Authorization: Bearer <key>`. The hosted server can't read local files, so `check_config` needs the config passed in as the `config` argument.
