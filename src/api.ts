import { readFileSync } from 'node:fs';

/** Shapes returned by https://trustedmcp.io/api/v1 (docs: https://trustedmcp.io/developers). */
export interface Check {
  check: string;
  state: 'full' | 'part' | 'empty';
  note: string;
}

export interface ServerSummary {
  slug: string;
  name: string;
  vendor: string | null;
  summary: string | null;
  category: { slug: string; name: string } | null;
  grade: 'A' | 'B' | 'C' | 'D';
  checks: Check[];
  checks_at_full_marks: number;
  fix_first: string | null;
  known_cves: number;
  maintainer_activity: string | null;
  last_updated: string | null;
  repo_url: string | null;
  url: string;
  badge_url: string;
}

export interface ServerDetail extends ServerSummary {
  auth_support: string | null;
  auth_note: string | null;
  transport: string | null;
  homepage_url: string | null;
  alternatives: Array<{ slug: string; name: string; grade: string; url: string }>;
  registry: RegistrySummary[];
}

export interface RegistrySummary {
  name: string;
  title: string | null;
  description: string | null;
  status: string;
  version: string | null;
  runs_as: string[];
  repo_url: string | null;
  website_url: string | null;
  reported_issues: number;
  listed_version_affected: boolean;
  graded_listing: { slug: string; grade: string; url: string } | null;
  url: string;
}

export interface Advisory {
  id: string;
  also_known_as: string[];
  title: string;
  severity: string | null;
  listed_version: 'affected' | 'not flagged' | 'not checked';
  published_at: string | null;
  url: string;
}

export interface RegistryDetail extends RegistrySummary {
  packages: Array<{ type?: string; identifier?: string; version?: string }>;
  remotes: Array<{ type?: string; url?: string }>;
  versions_tracked: number;
  registry_updated_at: string | null;
  issues_checked_at: string | null;
  advisories: Advisory[];
}

export interface Meta {
  note: string;
  docs: string;
  [key: string]: unknown;
}

export interface CheckResult {
  name: string | null;
  identifiers: string[];
  status: 'graded' | 'registry_only' | 'unknown';
  matched_by: string | null;
  server: ServerDetail | null;
  registry: RegistrySummary | null;
}

export interface CheckSummary {
  total: number;
  graded: number;
  by_grade: Record<'A' | 'B' | 'C' | 'D', number>;
  registry_only: number;
  unknown: number;
  request_review: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const DEFAULT_BASE_URL = 'https://trustedmcp.io/api/v1';

export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface ApiOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Thin client for the TrustedMCP API. Reads TRUSTEDMCP_API_URL and TRUSTEDMCP_API_KEY by default. */
export class TrustedMcpApi {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent = `trustedmcp-mcp/${packageVersion()} (+https://trustedmcp.io/developers)`;

  constructor(options: ApiOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.TRUSTEDMCP_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const key = options.apiKey ?? process.env.TRUSTEDMCP_API_KEY;
    this.apiKey = key && key.trim() !== '' ? key.trim() : undefined;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  lookup(q: string) {
    return this.get<{ data: { query: string; identifiers: string[]; graded: ServerSummary[]; registry: RegistrySummary[] }; meta: Meta }>(
      `/lookup?q=${encodeURIComponent(q)}`,
    );
  }

  server(slug: string) {
    return this.get<{ data: ServerDetail; meta: Meta }>(`/servers/${encodeURIComponent(slug)}`);
  }

  servers(params: { q?: string; category?: string; min_grade?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return this.get<{ data: ServerSummary[]; meta: Meta & { total: number } }>(`/servers${s ? `?${s}` : ''}`);
  }

  categories() {
    return this.get<{ data: Array<{ slug: string; name: string; graded_servers: number }>; meta: Meta }>('/categories');
  }

  registry(name: string) {
    // Registry names contain a slash that must stay a path separator.
    return this.get<{ data: RegistryDetail; meta: Meta }>(`/registry/${name.split('/').map(encodeURIComponent).join('/')}`);
  }

  /** Sends names and identifiers only (see config.ts). */
  check(servers: Array<{ name: string; identifiers: string[] }>) {
    return this.request<{ data: CheckResult[]; meta: Meta & { summary: CheckSummary } }>('/check', {
      method: 'POST',
      body: JSON.stringify({ servers }),
    });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': this.userAgent };
    if (init.body) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ApiError(0, 'network', `Could not reach the TrustedMCP API (${(e as Error).message}).`);
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON; handled below
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string }; message?: string } | null) ?? null;
      const retry = Number(res.headers.get('retry-after') ?? '') || undefined;
      throw new ApiError(
        res.status,
        err?.error?.code ?? (res.status === 422 ? 'invalid_request' : `http_${res.status}`),
        err?.error?.message ?? err?.message ?? `The TrustedMCP API answered HTTP ${res.status}.`,
        retry,
      );
    }
    if (json === null) throw new ApiError(res.status, 'bad_response', 'The TrustedMCP API sent a response that is not JSON.');
    return json as T;
  }
}
