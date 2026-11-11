import { describe, expect, it } from 'vitest';
import { fromCommand, npm, oci, pypi, remote } from '../src/identifiers.js';

// Same cases as the API's tests/Unit/IdentifiersTest.php, so both sides agree.
describe('identifiers', () => {
  it('drops versions and case from packages', () => {
    expect(npm('@Playwright/MCP@latest')).toBe('npm:@playwright/mcp');
    expect(npm('some-mcp@1.2.3')).toBe('npm:some-mcp');
    expect(npm('not a package')).toBeNull();
    expect(pypi('mcp_server.Fetch==0.6')).toBe('pypi:mcp-server-fetch');
    expect(oci('ghcr.io/github/github-mcp-server:latest')).toBe('oci:ghcr.io/github/github-mcp-server');
    expect(oci('mcp/github')).toBe('oci:docker.io/mcp/github');
    expect(oci('redis:7')).toBe('oci:docker.io/library/redis');
  });

  it('keeps no query, userinfo or trailing slash in remote URLs', () => {
    expect(remote('https://user:pw@MCP.example.com/mcp/?token=abc#x')).toBe('remote:mcp.example.com/mcp');
    expect(remote('http://localhost:3000/sse')).toBe('remote:localhost:3000/sse');
    expect(remote('ftp://example.com')).toBeNull();
    expect(remote('not a url')).toBeNull();
  });

  it('names the package a command runs', () => {
    expect(fromCommand('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/home/me'])).toEqual(['npm:@modelcontextprotocol/server-filesystem']);
    expect(fromCommand('C:\\Program Files\\nodejs\\npx.cmd', ['--yes', '@scope/pkg@2'])).toEqual(['npm:@scope/pkg']);
    expect(fromCommand('cmd', ['/c', 'npx', '-y', 'win-pkg'])).toEqual(['npm:win-pkg']);
    expect(fromCommand('pnpm', ['dlx', 'pkg'])).toEqual(['npm:pkg']);
    expect(fromCommand('uvx', ['mcp-server-git', '--repository', '.'])).toEqual(['pypi:mcp-server-git']);
    expect(fromCommand('uvx', ['--from', 'real-pkg', 'cli-name'])).toEqual(['pypi:real-pkg']);
    expect(fromCommand('python', ['-m', 'mcp_server_time'])).toEqual(['pypi:mcp-server-time']);
    expect(fromCommand('docker', ['run', '-i', '--rm', '-e', 'TOKEN', '-p', '127.0.0.1:80:80', '--env=X=1', 'ghcr.io/acme/probe:1'])).toEqual(['oci:ghcr.io/acme/probe']);
    expect(fromCommand('docker', ['pull', 'x'])).toEqual([]);
    expect(fromCommand('node', ['/path/to/server.js'])).toEqual([]);
  });
});
