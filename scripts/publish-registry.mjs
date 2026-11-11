#!/usr/bin/env node
/**
 * Publish server.json to the official MCP Registry as io.trustedmcp/trustedmcp.
 *
 *   node scripts/publish-registry.mjs            validate + publish
 *   node scripts/publish-registry.mjs --dry-run  validate only
 *
 * Run after `npm publish` of the same version. Steps:
 *  1. checks that package.json, server.json and npm agree on the version and mcpName;
 *  2. installs mcp-publisher (pinned, SHA-256 checked) into ~/.mcp-registry/bin if it isn't on PATH;
 *  3. logs in with HTTP domain proof: trustedmcp.io/.well-known/mcp-registry-auth serves the
 *     public key, and the private key stays in MCP_REGISTRY_KEY (default
 *     ~/.mcp-registry/trustedmcp.io-ed25519.pem). Never commit that file;
 *  4. runs `mcp-publisher validate`, then `mcp-publisher publish`.
 */
import { createHash, createPrivateKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUBLISHER_VERSION = '1.8.9';
const DOMAIN = 'trustedmcp.io';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = join(homedir(), '.mcp-registry');
const keyPath = process.env.MCP_REGISTRY_KEY || join(home, 'trustedmcp.io-ed25519.pem');
const dryRun = process.argv.includes('--dry-run');
const win = process.platform === 'win32';

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n→ ${message}`);
}

function run(cmd, args, { quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8', shell: false });
  return r;
}

// 1. Versions and names agree.
step('Checking package.json, server.json and npm');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'));
const npmPkg = server.packages?.find((p) => p.registryType === 'npm');
if (server.name !== pkg.mcpName) fail(`server.json name (${server.name}) must equal package.json mcpName (${pkg.mcpName}).`);
if (server.version !== pkg.version || npmPkg?.version !== pkg.version) {
  fail(`Versions differ: package.json ${pkg.version}, server.json ${server.version}, server.json package ${npmPkg?.version}. Make them the same.`);
}
const npmView = spawnSync(win ? 'npm.cmd' : 'npm', ['view', `${pkg.name}@${pkg.version}`, 'mcpName'], { encoding: 'utf8', shell: win });
const publishedName = (npmView.stdout || '').trim();
if (npmView.status !== 0 || publishedName === '') {
  fail(`${pkg.name}@${pkg.version} is not on npm yet (or has no mcpName). Run "npm publish" first, then this script.`);
}
if (publishedName !== server.name) fail(`npm's ${pkg.name}@${pkg.version} has mcpName "${publishedName}", not "${server.name}".`);
console.log(`  ${server.name} ${pkg.version}: package.json, server.json and npm agree.`);

// 2. mcp-publisher.
step('Finding mcp-publisher');
let publisher = 'mcp-publisher';
if (run(publisher, ['--version'], { quiet: true }).status !== 0) {
  const bin = join(home, 'bin');
  publisher = join(bin, win ? 'mcp-publisher.exe' : 'mcp-publisher');
  if (!existsSync(publisher)) {
    const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
    const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
    if (!os || !arch) fail(`No mcp-publisher build for ${process.platform}/${process.arch}.`);
    const asset = `mcp-publisher_${os}_${arch}.tar.gz`;
    const base = `https://github.com/modelcontextprotocol/registry/releases/download/v${PUBLISHER_VERSION}`;
    console.log(`  Downloading ${asset} (v${PUBLISHER_VERSION})`);
    const [archive, sums] = await Promise.all([
      fetch(`${base}/${asset}`).then((r) => (r.ok ? r.arrayBuffer() : fail(`Download failed: HTTP ${r.status}`))),
      fetch(`${base}/registry_${PUBLISHER_VERSION}_checksums.txt`).then((r) => (r.ok ? r.text() : fail(`Checksums download failed: HTTP ${r.status}`))),
    ]);
    const expected = sums.split('\n').find((l) => l.trim().endsWith(` ${asset}`))?.split(/\s+/)[0];
    const actual = createHash('sha256').update(Buffer.from(archive)).digest('hex');
    if (!expected || expected !== actual) fail(`Checksum mismatch for ${asset}; not installing.`);
    console.log('  Checksum OK');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, asset), Buffer.from(archive));
    // Relative names only: GNU tar on Windows reads "C:" as a remote host.
    const untar = spawnSync('tar', ['-xzf', asset], { cwd: bin, stdio: 'inherit' });
    if (untar.status !== 0 || !existsSync(publisher)) fail(`Could not unpack ${asset} in ${bin}.`);
  }
}
const version = run(publisher, ['--version'], { quiet: true });
if (version.status !== 0) fail(`mcp-publisher does not run: ${version.stderr || version.error}`);
console.log(`  ${(version.stdout || version.stderr).trim()}`);

// 3. Login with the domain key.
step(`Logging in as ${DOMAIN} (HTTP domain proof)`);
if (!existsSync(keyPath)) fail(`No private key at ${keyPath}. Set MCP_REGISTRY_KEY to its path.`);
let privateHex;
try {
  // Ed25519: the JWK "d" is the 32-byte private seed, which mcp-publisher wants as hex.
  privateHex = Buffer.from(createPrivateKey(readFileSync(keyPath)).export({ format: 'jwk' }).d, 'base64url').toString('hex');
} catch (e) {
  fail(`Could not read the private key at ${keyPath}: ${e.message}`);
}
if (privateHex.length !== 64) fail('The key is not an Ed25519 key.');
const proof = await fetch(`https://${DOMAIN}/.well-known/mcp-registry-auth`).then((r) => (r.ok ? r.text() : ''));
if (!proof.startsWith('v=MCPv1; k=ed25519; p=')) fail(`https://${DOMAIN}/.well-known/mcp-registry-auth does not serve the public key. Check MCP_REGISTRY_AUTH in the live .env.`);
if (run(publisher, ['login', 'http', '--domain', DOMAIN, '--private-key', privateHex]).status !== 0) fail('Login failed.');

// 4. Validate, then publish.
step('Validating server.json');
if (run(publisher, ['validate']).status !== 0) fail('server.json did not validate.');
if (dryRun) {
  console.log('\n✓ Dry run: logged in and validated. Run without --dry-run to publish.');
  process.exit(0);
}
step('Publishing to the official MCP Registry');
if (run(publisher, ['publish']).status !== 0) fail('Publish failed.');
console.log(`\n✓ Published ${server.name} ${server.version}.`);
console.log(`  Check: https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(server.name)}`);
