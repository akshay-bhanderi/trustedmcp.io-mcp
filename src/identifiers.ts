/**
 * Package and endpoint identifiers, built on the user's machine from an MCP config entry.
 * Only these leave the machine: never env vars, headers, file paths or other arguments.
 *
 *   npm:@scope/name   pypi:name   oci:ghcr.io/owner/image   remote:host/path
 *
 * Same rules as the TrustedMCP API (app/Services/Api/Identifiers.php), which re-normalizes
 * whatever it receives.
 */

const RUNNERS: Record<string, 'npm' | 'pypi' | 'oci'> = {
  npx: 'npm',
  bunx: 'npm',
  uvx: 'pypi',
  docker: 'oci',
  podman: 'oci',
};

/** docker/podman run flags that take a value as the next argument. */
const DOCKER_VALUE_FLAGS = new Set([
  '-e', '--env', '--env-file', '-p', '--publish', '-v', '--volume', '--mount', '--name',
  '--network', '--net', '-w', '--workdir', '-u', '--user', '--entrypoint', '-l', '--label',
  '--add-host', '--platform', '--pull', '--cpus', '-m', '--memory', '--hostname', '-h',
  '--dns', '--cap-add', '--cap-drop', '--security-opt', '--tmpfs', '--ulimit', '--device',
]);

export function npm(value: string): string | null {
  let v = value.trim().toLowerCase().replace(/^npm:/, '');
  const at = v.indexOf('@', 1); // the version separator, never a scope's leading @
  if (at !== -1) v = v.slice(0, at);
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(v) ? `npm:${v}` : null;
}

export function pypi(value: string): string | null {
  let v = (value.trim().toLowerCase().split(/[[=<>!~@\s;]/)[0] ?? '');
  v = v.replace(/[-_.]+/g, '-');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v) ? `pypi:${v}` : null;
}

export function oci(value: string): string | null {
  let v = value.trim().toLowerCase().replace(/^(docker|oci):\/\//, '').replace(/@sha256:[a-f0-9]+$/, '');
  const slash = v.lastIndexOf('/');
  const colon = v.lastIndexOf(':');
  if (colon !== -1 && colon > slash) v = v.slice(0, colon);
  const parts = v.split('/');
  const first = parts[0] ?? '';
  if (parts.length === 1 || (!first.includes('.') && !first.includes(':') && first !== 'localhost')) {
    if (parts.length === 1) parts.unshift('library');
    parts.unshift('docker.io');
  }
  if (parts[0] === 'index.docker.io' || parts[0] === 'registry-1.docker.io') parts[0] = 'docker.io';
  v = parts.join('/');
  return /^[a-z0-9.-]+(:\d+)?(\/[a-z0-9._-]+)+$/.test(v) ? `oci:${v}` : null;
}

/** Host and path only: query, fragment and userinfo (where tokens live) are dropped. */
export function remote(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const port = url.port && url.port !== '80' && url.port !== '443' ? `:${url.port}` : '';
  const path = url.pathname.replace(/\/+$/, '');
  return `remote:${url.hostname.toLowerCase()}${port}${path}`;
}

function make(type: 'npm' | 'pypi' | 'oci', value: string | undefined): string | null {
  if (!value || value.length > 300) return null;
  return type === 'npm' ? npm(value) : type === 'pypi' ? pypi(value) : oci(value);
}

function baseCommand(command: string): string {
  const name = command.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  return name.toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
}

/** Identifiers for one launch command, e.g. ("npx", ["-y", "@playwright/mcp@latest"]). */
export function fromCommand(command: string, args: string[] = []): string[] {
  const cmd = baseCommand(command);
  const a = args.map((x) => String(x).trim());

  // Wrappers: "cmd /c npx ...", "pnpm dlx", "yarn dlx", "npm exec", "uv tool run", "pipx run".
  if (cmd === 'cmd' && /^\/c$/i.test(a[0] ?? '') && a[1]) return fromCommand(a[1], a.slice(2));
  if ((cmd === 'pnpm' || cmd === 'yarn') && a[0] === 'dlx') return fromCommand('npx', a.slice(1));
  if (cmd === 'npm' && (a[0] === 'exec' || a[0] === 'x')) return fromCommand('npx', a.slice(1));
  if (cmd === 'uv' && a[0] === 'tool' && a[1] === 'run') return fromCommand('uvx', a.slice(2));
  if (cmd === 'pipx' && a[0] === 'run') return fromCommand('uvx', a.slice(1));
  // "python -m package_module": the module name usually is the PyPI name.
  if (/^python(3(\.\d+)?)?$/.test(cmd) && a[0] === '-m' && a[1]) {
    const id = pypi(a[1].replace(/_/g, '-'));
    return id ? [id] : [];
  }

  const type = RUNNERS[cmd];
  if (!type) return [];
  let rest = a;
  if (type === 'oci') {
    if (rest[0] !== 'run') return [];
    rest = rest.slice(1);
  }

  const out: string[] = [];
  let explicit = false; // -p/--package/--from named the package; the next bare argument is a command name
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--') continue;
    if (arg.startsWith('-')) {
      const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (type !== 'oci' && (flag === '-p' || flag === '--package' || flag === '--from')) {
        const value = arg.includes('=') ? arg.slice(flag.length + 1) : rest[++i];
        const id = make(type, value);
        if (id) out.push(id);
        explicit = true;
      } else if (type === 'oci' && !arg.includes('=') && DOCKER_VALUE_FLAGS.has(flag)) {
        i++;
      }
      continue;
    }
    if (!explicit) {
      const id = make(type, arg);
      if (id) out.push(id);
    }
    break;
  }
  return [...new Set(out)];
}
