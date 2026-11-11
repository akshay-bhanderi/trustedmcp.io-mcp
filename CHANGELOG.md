# Changelog

## 0.1.0 (unreleased)

First version.

- MCP server over stdio: `npx -y trustedmcp mcp`.
- Tools: `lookup_server`, `check_config`, `find_alternatives`, `registry_lookup`.
- `check_config` reads Claude Desktop, Claude Code, Cursor, VS Code and Windsurf configs locally and sends only package names, image names and server URLs.
- Optional `TRUSTEDMCP_API_KEY` for a higher rate limit.
