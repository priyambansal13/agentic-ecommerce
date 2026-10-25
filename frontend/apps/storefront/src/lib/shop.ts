import 'server-only';
import { getSession, loginUrl, type Session } from '@ac/bff';
import { redirect } from 'next/navigation';

const app = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '');
/** Absolute URL for server-action redirects (a form posted before hydration loses the /shop basePath otherwise). */
export const shopUrl = (path: string) => `${app()}/shop${path}`;
/** Cross-zone absolute URL (account, seller …). */
export const siteUrl = (path: string) => `${app()}${path}`;

/** Checkout and payment pages need a signed-in customer (staff are sent to their console). */
export async function requireBuyer(returnTo: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(loginUrl('customers', returnTo));
  if (session.realm !== 'customers') redirect(siteUrl('/admin'));
  return session;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delivery estimate shown before the seller ships: 3–5 days (business promise, not a carrier ETA). */
export function deliveryWindow(from = new Date()) {
  const d = (n: number) => new Date(from.getTime() + n * 86_400_000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${d(3)} – ${d(5)}`;
}

/** Last delivery address (encrypted with the session key, httpOnly, path /shop) — never in browser storage. */
export const ADDRESS_COOKIE = 'ac_addr';
