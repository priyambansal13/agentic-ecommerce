import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Service-to-service HTTP through Kong (`KONG_URL/api/<svc>/v1/...`) with a client-credentials token of the
 * customers-realm `services` client (realm role `service` → allowed on `/v1/internal/...` endpoints).
 *
 *   constructor(private readonly svc: ServiceClient) {}
 *   const r = await this.svc.call('inventory', 'POST', '/internal/reservations', { body, timeoutMs: 1500, idempotencyKey: orderId });
 *
 * - token cached until 30 s before expiry; per-call timeout (default 2 s)
 * - retries (2, jittered) only for GET or calls carrying an Idempotency-Key
 * - circuit breaker per target service: open after 5 consecutive failures for 30 s (fails fast with DependencyError)
 * - non-2xx → DependencyError with status + parsed body (callers map 409/422 to domain outcomes)
 * Services that call others declare `"calls": [...]` in package.json "ac"; `ac configure` then writes
 * KONG_URL, SERVICES_CLIENT_ID, SERVICES_CLIENT_SECRET (and OIDC token URL comes from OIDC_ISSUERS).
 */
export class DependencyError extends Error {
  constructor(
    readonly target: string,
    readonly status: number, // 0 = network/timeout/breaker-open
    readonly body: unknown,
    message: string,
    readonly reason: 'timeout' | 'network' | 'circuit_open' | 'http' | 'auth' | 'contract' = 'http',
  ) {
    super(message);
  }
}

export interface CallOptions<S extends z.ZodType | undefined = undefined> {
  body?: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
  /** forward the end user's bearer token instead of the service token */
  userToken?: string;
  headers?: Record<string, string>;
  schema?: S;
}

type Fetch = typeof fetch;

export class TokenCache {
  private token?: { value: string; exp: number };
  private inflight?: Promise<string>;
  constructor(
    private readonly fetchToken: () => Promise<{ access_token: string; expires_in: number }>,
    private readonly now: () => number = Date.now,
  ) {}
  async get(): Promise<string> {
    if (this.token && this.now() < this.token.exp - 30_000) return this.token.value;
    this.inflight ??= this.fetchToken()
      .then((t) => {
        this.token = { value: t.access_token, exp: this.now() + t.expires_in * 1000 };
        return t.access_token;
      })
      .finally(() => (this.inflight = undefined));
    return this.inflight;
  }
  invalidate() {
    this.token = undefined;
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(
    private readonly threshold = 5,
    private readonly openMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}
  /** true when calls may proceed (closed, or half-open after the cool-down) */
  allow() {
    return this.failures < this.threshold || this.now() - this.openedAt >= this.openMs;
  }
  success() {
    this.failures = 0;
  }
  failure() {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
  get state() {
    return this.failures < this.threshold ? 'closed' : this.now() - this.openedAt >= this.openMs ? 'half-open' : 'open';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class ServiceClient {
  private readonly log = new Logger(ServiceClient.name);
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly tokens: TokenCache;

  /**
   * `credentials` (optional) overrides the client used for the token — e.g. the agents service uses its own
   * `agents` client (realm roles `service` + `agent`) instead of `services`; values are read lazily from env.
   */
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly credentials?: { clientIdEnv?: string; clientId?: string; clientSecretEnv: string },
  ) {
    this.tokens = new TokenCache(() => this.requestToken());
  }

  private get kong() {
    return (process.env.KONG_URL ?? 'http://localhost:58000').replace(/\/$/, '');
  }

  /** token endpoint of the customers realm, from OIDC_ISSUERS (+ OIDC_JWKS_REWRITE inside the cluster) */
  private tokenUrl() {
    const iss = (process.env.OIDC_ISSUERS ?? '').split(',').map((s) => s.trim()).find((s) => s.endsWith('/realms/customers'));
    if (!iss) throw new DependencyError('keycloak', 0, null, 'OIDC_ISSUERS has no customers realm', 'auth');
    const [from, to] = (process.env.OIDC_JWKS_REWRITE ?? '').split('=');
    const base = from && to && iss.startsWith(from) ? to + iss.slice(from.length) : iss;
    return `${base}/protocol/openid-connect/token`;
  }

  private async requestToken() {
    const c = this.credentials;
    const id = c ? (c.clientId ?? process.env[c.clientIdEnv ?? ''] ?? 'services') : (process.env.SERVICES_CLIENT_ID ?? 'services');
    const secret = c ? process.env[c.clientSecretEnv] : process.env.SERVICES_CLIENT_SECRET;
    if (!secret) throw new DependencyError('keycloak', 0, null, 'SERVICES_CLIENT_SECRET not configured (add "calls" to the service metadata and run ac configure)', 'auth');
    const r = await this.fetchImpl(this.tokenUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(3000),
    }).catch((e) => {
      throw new DependencyError('keycloak', 0, null, `token request failed: ${(e as Error).message}`, 'auth');
    });
    if (!r.ok) throw new DependencyError('keycloak', r.status, null, `token request ${r.status}`, 'auth');
    return (await r.json()) as { access_token: string; expires_in: number };
  }

  breaker(target: string) {
    let b = this.breakers.get(target);
    if (!b) this.breakers.set(target, (b = new CircuitBreaker()));
    return b;
  }

  async call<S extends z.ZodType | undefined = undefined>(
    target: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: CallOptions<S> = {},
  ): Promise<S extends z.ZodType ? z.infer<S> : any> {
    const b = this.breaker(target);
    if (!b.allow()) throw new DependencyError(target, 0, null, `${target}: circuit open`, 'circuit_open');
    const retryable = method === 'GET' || !!opts.idempotencyKey;
    const attempts = retryable ? 3 : 1;
    let last: DependencyError | undefined;
    for (let i = 0; i < attempts; i++) {
      if (i) await sleep(100 * 2 ** i + Math.random() * 100);
      try {
        const out = await this.once(target, method, path, opts);
        b.success();
        return out;
      } catch (e) {
        last = e instanceof DependencyError ? e : new DependencyError(target, 0, null, (e as Error).message, 'network');
        // 4xx are answers, not failures: no retry, breaker untouched (except 401 → refresh token once)
        if (last.status >= 400 && last.status < 500) {
          if (last.status === 401 && !opts.userToken && i === 0) {
            this.tokens.invalidate();
            continue;
          }
          throw last;
        }
        b.failure();
        if (!b.allow()) break;
      }
    }
    this.log.warn(`${method} ${target}${path} failed: ${last?.message} (breaker ${b.state})`);
    throw last!;
  }

  private async once(target: string, method: string, path: string, opts: CallOptions<any>) {
    const token = opts.userToken ?? (await this.tokens.get());
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json', ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    const url = `${this.kong}/api/${target}/v1${path.startsWith('/') ? path : `/${path}`}`;
    let r: Response;
    try {
      r = await this.fetchImpl(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(opts.timeoutMs ?? 2000) });
    } catch (e) {
      const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
      throw new DependencyError(target, 0, null, `${target}: ${timeout ? 'timeout' : (e as Error).message}`, timeout ? 'timeout' : 'network');
    }
    const text = await r.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!r.ok) throw new DependencyError(target, r.status, body, `${target} ${method} ${path} → ${r.status}`);
    if (opts.schema) {
      const parsed = opts.schema.safeParse(body);
      if (!parsed.success) throw new DependencyError(target, 502, body, `${target} response did not match the contract`, 'contract');
      return parsed.data;
    }
    return body;
  }
}
