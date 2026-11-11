# Changelog

## 0.2.0 (2026-11-12)

**Breaking: tool calls now need a free API key.**

- Set `TRUSTEDMCP_API_KEY` (npx server) or send `Authorization: Bearer <key>` (hosted server). Get a key by email at https://trustedmcp.io/developers#key.
- Without a key the server still starts and lists its tools, but every tool call returns an error and makes no API request.
- Keys are scoped: `servers:read` for `lookup_server` and `find_alternatives`, `config:check` for `check_config`, `registry:read` for `registry_lookup`. `registry_lookup` also uses `servers:read` when it falls back to a search.
- A key without the needed scope gets the API's message saying which scope is missing. A rejected or revoked key gets a message with the link for a new one.
- The server's instructions mention the key. The CLI prints a warning to stderr when it starts without one.
- `server.json`: `TRUSTEDMCP_API_KEY` and the remote's `Authorization` header are now required.
- README: key setup, scopes, and every install snippet updated.

## 0.1.1 (2026-11-12)

- Hosted option: the same four tools at `https://trustedmcp.io/mcp` (Streamable HTTP), listed as a remote in `server.json`. No install needed.
- The API key is optional there too: 30 requests a minute without one, 300 with `Authorization: Bearer <key>`.
- Hosted `check_config` only accepts the pasted `config` argument. It can't read files on your machine.
- README: install steps for the hosted server.
- No change to the npx server.

## 0.1.0 (2026-11-11)

First version.

- MCP server over stdio: `npx -y trustedmcp mcp`.
- Tools: `lookup_server`, `check_config`, `find_alternatives`, `registry_lookup`.
- `check_config` reads Claude Desktop, Claude Code, Cursor, VS Code and Windsurf configs locally and sends only package names, image names and server URLs.
- Optional `TRUSTEDMCP_API_KEY` for a higher rate limit.
