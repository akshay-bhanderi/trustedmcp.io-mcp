#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { packageVersion } from './api.js';
import { createServer } from './server.js';

const HELP = `trustedmcp ${packageVersion()}: TrustedMCP grades for your agent

Usage:
  trustedmcp mcp        Run the MCP server over stdio (what your MCP client starts)
  trustedmcp --version  Print the version
  trustedmcp help       Show this help

Add it to your MCP client:
  claude mcp add trustedmcp -e TRUSTEDMCP_API_KEY=YOUR_KEY -- npx -y trustedmcp mcp
  { "mcpServers": { "trustedmcp": { "command": "npx", "args": ["-y", "trustedmcp", "mcp"], "env": { "TRUSTEDMCP_API_KEY": "YOUR_KEY" } } } }

Environment:
  TRUSTEDMCP_API_KEY    Free key from https://trustedmcp.io/developers#key, required for tool calls
                        (scopes: servers:read, config:check, registry:read)
  TRUSTEDMCP_API_URL    API base URL (default https://trustedmcp.io/api/v1)
`;

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  if (command === '--version' || command === '-v') {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (command === 'help' || command === '--help' || command === '-h' || (command === undefined && process.stdin.isTTY)) {
    process.stdout.write(HELP);
    return;
  }
  // No command and no terminal: an MCP client started us, so serve.
  if (command === undefined || command === 'mcp') {
    if (!process.env.TRUSTEDMCP_API_KEY?.trim()) {
      console.error('trustedmcp: TRUSTEDMCP_API_KEY is not set. Tool calls will fail until you set it. Free key: https://trustedmcp.io/developers#key');
    }
    const server = createServer();
    await server.connect(new StdioServerTransport());
    // stdout is the protocol channel; anything for humans goes to stderr.
    console.error(`trustedmcp ${packageVersion()} MCP server running on stdio`);
    return;
  }
  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
