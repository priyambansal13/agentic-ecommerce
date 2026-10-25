import 'server-only';
import { cookies } from 'next/headers.js';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { getSession } from './session.js';

/**
 * Cart session for guests (order service: `X-Cart-Session`). The id is 128 random bits in an httpOnly cookie, so
 * browser JS never sees it; signed-in carts are keyed by the token's sub. On login the shell's auth callback merges
 * the guest cart into the buyer's cart (`mergeGuestCart`) and clears the cookie.
 */
export const CART_COOKIE = 'ac_cart';
const ID = /^[0-9a-f]{32}$/;
const kong = () => process.env.KONG_URL ?? 'http://localhost:58000';
const secure = () => (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://');

/** Read the guest cart id (server components, actions, route handlers). */
export async function cartSessionId(): Promise<string | null> {
  const v = (await cookies()).get(CART_COOKIE)?.value;
  return v && ID.test(v) ? v : null;
}

/** Create the guest cart id if missing — only callable where cookies can be set (Server Action / route handler). */
export async function ensureCartSession(): Promise<string> {
  const existing = await cartSessionId();
  if (existing) return existing;
  const id = randomBytes(16).toString('hex');
  (await cookies()).set(CART_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: secure(), path: '/', maxAge: 7 * 86400 });
  return id;
}

async function cartHeaders(opts: { create?: boolean } = {}): Promise<Record<string, string>> {
  const session = await getSession();
  const h: Record<string, string> = { accept: 'application/json' };
  if (session && session.realm === 'customers') h.authorization = `Bearer ${session.accessToken}`;
  else {
    const id = opts.create ? await ensureCartSession() : await cartSessionId();
    if (id) h['x-cart-session'] = id;
  }
  return h;
}

export type CartResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

async function call<S extends z.ZodType>(schema: S | null, method: string, path: string, body: unknown, opts: { create?: boolean; timeoutMs?: number } = {}): Promise<CartResult<z.infer<S>>> {
  const headers = await cartHeaders(opts);
  // a guest with no cart yet has nothing to read
  if (method === 'GET' && !headers.authorization && !headers['x-cart-session']) return { ok: false, status: 204, error: 'no cart' };
  let res: Response;
  try {
    res = await fetch(`${kong()}/api/order/v1${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: 'The cart is unavailable right now. Please try again.' };
  }
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const m = json?.message;
    return { ok: false, status: res.status, error: Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : `Cart request failed (HTTP ${res.status})`, code: json?.code };
  }
  if (!schema) return { ok: true, data: json };
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 502, error: 'response did not match the contract' };
}

/** GET /cart — never throws. */
export const loadCart = <S extends z.ZodType>(schema: S, timeoutMs = 4000) => call(schema, 'GET', '/cart', undefined, { timeoutMs });

/** Add / change qty / remove — creates the guest cart cookie on first add (Server Actions only). Writes re-price
 *  through catalog + inventory, so they get 8 s; reads 4 s. */
export const cartAdd = <S extends z.ZodType>(schema: S, offerId: string, qty: number) => call(schema, 'POST', '/cart/items', { offerId, qty }, { create: true, timeoutMs: 8000 });
export const cartSetQty = <S extends z.ZodType>(schema: S, offerId: string, qty: number) =>
  qty <= 0 ? call(schema, 'DELETE', `/cart/items/${offerId}`, undefined, { timeoutMs: 8000 }) : call(schema, 'PATCH', `/cart/items/${offerId}`, { qty }, { timeoutMs: 8000 });

/** Header badge: item count, 0 when there is no cart or the order service is down (2.5 s budget — the first read after an add re-prices from catalog + inventory). */
export async function cartCount(): Promise<number> {
  const r = await call(null, 'GET', '/cart', undefined, { timeoutMs: 2500 });
  return r.ok && typeof (r.data as { itemCount?: unknown })?.itemCount === 'number' ? (r.data as { itemCount: number }).itemCount : 0;
}

/**
 * Move the guest cart into the signed-in buyer's cart. Called by the shell's auth callback right after login (and
 * by the cart page as a fallback). Clears the guest cookie only when the order service confirmed the merge.
 */
export async function mergeGuestCart(accessToken: string): Promise<boolean> {
  const id = await cartSessionId();
  if (!id) return true;
  try {
    const res = await fetch(`${kong()}/api/order/v1/cart/merge`, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}`, 'x-cart-session': id },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    (await cookies()).delete(CART_COOKIE);
    return true;
  } catch {
    return false;
  }
}
