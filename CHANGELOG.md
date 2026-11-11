# Changelog

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
