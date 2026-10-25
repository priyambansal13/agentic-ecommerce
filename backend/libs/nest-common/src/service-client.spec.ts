import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, DependencyError, ServiceClient, TokenCache } from './service-client.js';

describe('TokenCache', () => {
  it('reuses the token until 30 s before expiry, then refreshes', async () => {
    let now = 0;
    const fetchToken = vi.fn(async () => ({ access_token: `t${fetchToken.mock.calls.length}`, expires_in: 300 }));
    const c = new TokenCache(fetchToken, () => now);
    expect(await c.get()).toBe('t1');
    now = 260_000;
    expect(await c.get()).toBe('t1');
    now = 271_000;
    expect(await c.get()).toBe('t2');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
  it('dedupes concurrent refreshes', async () => {
    const fetchToken = vi.fn(async () => ({ access_token: 'x', expires_in: 300 }));
    const c = new TokenCache(fetchToken);
    await Promise.all([c.get(), c.get(), c.get()]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker', () => {
  it('opens after 5 failures, half-opens after 30 s, closes on success', () => {
    let now = 0;
    const b = new CircuitBreaker(5, 30_000, () => now);
    for (let i = 0; i < 4; i++) b.failure();
    expect(b.allow()).toBe(true);
    b.failure();
    expect(b.state).toBe('open');
    expect(b.allow()).toBe(false);
    now = 30_000;
    expect(b.state).toBe('half-open');
    expect(b.allow()).toBe(true);
    b.success();
    expect(b.state).toBe('closed');
  });
});

describe('ServiceClient', () => {
  const env = { OIDC_ISSUERS: 'http://kc/realms/customers', SERVICES_CLIENT_SECRET: 's', KONG_URL: 'http://kong' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const withEnv = async (fn: () => Promise<void>) => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    try { await fn(); } finally { process.env = old; }
  };

  it('does not retry a POST without Idempotency-Key and maps 409 to DependencyError with body', () => withEnv(async () => {
    const f = vi.fn(async (url: string) => (String(url).includes('/token') ? json(200, { access_token: 't', expires_in: 300 }) : json(409, { code: 'INSUFFICIENT_STOCK' })));
    const c = new ServiceClient(f as unknown as typeof fetch);
    const e = await c.call('inventory', 'POST', '/internal/reservations', { body: {} }).catch((x) => x);
    expect(e).toBeInstanceOf(DependencyError);
    expect(e.status).toBe(409);
    expect(e.body).toEqual({ code: 'INSUFFICIENT_STOCK' });
    expect(f.mock.calls.filter(([u]) => String(u).includes('/api/inventory')).length).toBe(1);
  }));

  it('retries GET on 5xx and opens the breaker after repeated failures', () => withEnv(async () => {
    const f = vi.fn(async (url: string) => (String(url).includes('/token') ? json(200, { access_token: 't', expires_in: 300 }) : json(503, {})));
    const c = new ServiceClient(f as unknown as typeof fetch);
    await c.call('catalog', 'GET', '/offers').catch(() => {});
    expect(f.mock.calls.filter(([u]) => String(u).includes('/api/catalog')).length).toBe(3);
    await c.call('catalog', 'GET', '/offers').catch(() => {});
    const e = await c.call('catalog', 'GET', '/offers').catch((x) => x);
    expect(e.reason).toBe('circuit_open');
  }));
});
