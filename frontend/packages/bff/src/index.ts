/**
 * Backend-for-frontend helpers used by every zone's route handlers / server components.
 * Server-only: the Kong URL and the user's access token (encrypted session cookie) never reach the browser JS.
 */
import 'server-only';
import type { z } from 'zod';
import { getSession } from './session.js';

export * from './auth-routes.js';
export * from './cart.js';
export * from './session.js';

export class KongError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Kong request failed: HTTP ${status}`);
  }
}

const kong = () => process.env.KONG_URL ?? 'http://localhost:58000';

/**
 * Call a backend microservice through the gateway: kongFetch('/api/catalog/v1/products/123').
 * Pass `token` (from the session) for authenticated calls; default timeout 5 s.
 */
export async function kongFetch<T = unknown>(path: string, init: RequestInit & { token?: string; timeoutMs?: number } = {}): Promise<T> {
  const { token, timeoutMs = 5000, headers, ...rest } = init;
  const res = await fetch(`${kong()}${path}`, {
    ...rest,
    headers: {
      accept: 'application/json',
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string>),
    },
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new KongError(res.status, await res.text());
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * AG-UI proxy for a zone. In src/app/api/agents/[agentId]/run/route.ts:
 *   export const POST = agentRoute({ allow: ['assistant', 'ping'] });
 * `allow` = agents this zone may host (zone boundary); everything else is 404 here.
 * Forwards the signed-in user's access token (session cookie) so the agents service knows who is asking.
 */
export function agentRoute(opts: { allow?: string[] } = {}) {
  return async function POST(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
    const { agentId } = await ctx.params;
    if (!/^[a-z0-9-]{1,40}$/.test(agentId)) return Response.json({ error: 'invalid agent id' }, { status: 400 });
    if (opts.allow && !opts.allow.includes(agentId)) return Response.json({ error: `agent ${agentId} is not available in this zone` }, { status: 404 });
    const session = await getSession();
    const upstream = await fetch(`${kong()}/api/agents/v1/agents/${agentId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}) },
      body: await req.text(),
      signal: req.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache, no-transform' },
    });
  };
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * Dashboard widget loader: GET through Kong with the signed-in user's token, validate against the contract
 * schema, and NEVER throw — one unavailable microservice degrades one widget, not the page.
 */
export async function load<S extends z.ZodType>(schema: S, path: string): Promise<Loaded<z.infer<S>>> {
  const session = await getSession();
  try {
    const raw = await kongFetch(path, { token: session?.accessToken, timeoutMs: 4000 });
    const parsed = schema.safeParse(raw);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 502, error: 'response did not match the contract' };
  } catch (e) {
    return e instanceof KongError ? { ok: false, status: e.status, error: e.status === 403 ? 'not permitted' : `HTTP ${e.status}` } : { ok: false, status: 503, error: 'service unavailable' };
  }
}

export type Sent<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; code?: string; issues?: { path: (string | number)[]; message: string }[]; /** the parsed error body (e.g. a rejection with offerIds) */ body?: unknown };

/**
 * Command helper for Server Actions / route handlers: POST/PUT/DELETE through Kong with the signed-in user's
 * token. NEVER throws — returns the service's error (message, 422 `code`, 400 `issues`) so the page can show it.
 * Pass `idempotencyKey` for money/stock mutations.
 */
export async function send<S extends z.ZodType = z.ZodUnknown>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { schema?: S; idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<Sent<z.infer<S>>> {
  const session = await getSession();
  let res: Response;
  try {
    res = await fetch(`${kong()}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: 'The service is unavailable right now. Please try again.' };
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const b = (json ?? {}) as { message?: unknown; code?: string; issues?: { path: (string | number)[]; message: string }[] };
    const message = Array.isArray(b.message) ? b.message.join(', ') : typeof b.message === 'string' ? b.message : res.status === 403 ? 'You are not permitted to do this.' : `Request failed (HTTP ${res.status})`;
    return { ok: false, status: res.status, error: message, code: b.code, issues: Array.isArray(b.issues) ? b.issues : undefined, body: json };
  }
  if (opts.schema) {
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: 502, error: 'response did not match the contract' };
    return { ok: true, status: res.status, data: parsed.data };
  }
  return { ok: true, status: res.status, data: json as z.infer<S> };
}

/**
 * Multipart upload (e.g. product images) through Kong with the signed-in user's token. Never throws; same
 * result shape as `send` (service message, 422 `code`).
 */
export async function sendForm(method: 'POST' | 'PUT', path: string, form: FormData, opts: { timeoutMs?: number } = {}): Promise<Sent<unknown>> {
  const session = await getSession();
  let res: Response;
  try {
    res = await fetch(`${kong()}${path}`, {
      method,
      headers: { accept: 'application/json', ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}) },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: 'The image service is unavailable right now. Please try again.' };
  }
  const text = await res.text();
  let json: { message?: unknown; code?: string } | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const m = json?.message;
    const message = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : res.status === 413 ? 'The file is too large.' : `Upload failed (HTTP ${res.status})`;
    return { ok: false, status: res.status, error: message, code: json?.code };
  }
  return { ok: true, status: res.status, data: json };
}

/** Public GET (no token needed) that never throws — same result shape as `load`. */
export async function loadPublic<S extends z.ZodType>(schema: S, path: string): Promise<Loaded<z.infer<S>>> {
  try {
    const raw = await kongFetch(path, { timeoutMs: 4000 });
    const parsed = schema.safeParse(raw);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 502, error: 'response did not match the contract' };
  } catch (e) {
    return e instanceof KongError ? { ok: false, status: e.status, error: e.status === 404 ? 'not found' : `HTTP ${e.status}` } : { ok: false, status: 503, error: 'service unavailable' };
  }
}

/**
 * Authenticated binary GET (e.g. return evidence photos) streamed back to the browser from a zone route handler.
 * The user's token stays server-side; responses are private (never cached by shared caches).
 */
export async function proxyBinary(path: string, opts: { timeoutMs?: number } = {}): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('sign in required', { status: 401 });
  let res: Response;
  try {
    res = await fetch(`${kong()}${path}`, { headers: { authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(opts.timeoutMs ?? 8000), cache: 'no-store' });
  } catch {
    return new Response('image service unavailable', { status: 503 });
  }
  if (!res.ok || !res.body) return new Response(null, { status: res.status === 200 ? 502 : res.status });
  return new Response(res.body, {
    status: 200,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
  });
}
