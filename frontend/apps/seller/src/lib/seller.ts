import 'server-only';
import { getSession, hasRole, load, loginUrl, type Session } from '@ac/bff';
import { SellerAccountSchema } from '@ac/contracts';
import { redirect } from 'next/navigation';

/** Signed-in customers-realm user (buyer or seller) — anyone may apply to sell. Staff are sent to their console. */
export async function requireCustomer(returnTo: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(loginUrl('customers', returnTo));
  if (session.realm !== 'customers') redirect(`${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '')}/admin`);
  return session;
}

/** The caller's seller account: `null` when they have not applied yet (404), `undefined` when user service is down. */
export async function myAccount() {
  const r = await load(SellerAccountSchema, '/api/user/v1/sellers/me');
  if (r.ok) return { account: r.data, error: null };
  return { account: r.status === 404 ? null : undefined, error: r.status === 404 ? null : r.error };
}

export const isSeller = (s: Session) => hasRole(s, 'seller');

/** Rupees typed in a form → integer minor units (paise). NaN/empty → undefined. */
export function toMinor(v: FormDataEntryValue | null): number | undefined {
  const n = Number(String(v ?? '').replace(/[,₹\s]/g, ''));
  return String(v ?? '').trim() === '' || !Number.isFinite(n) ? undefined : Math.round(n * 100);
}
export const str = (v: FormDataEntryValue | null) => String(v ?? '').trim();

/** Flash message through the URL after a Server Action redirect: ?ok=… or ?err=… */
/** Absolute URL for server-action redirects: before hydration (plain form POST) a relative redirect loses the /seller basePath. */
export const actionUrl = (path: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '')}/seller${path}`;
export const flash = (path: string, kind: 'ok' | 'err', msg: string) => `${actionUrl(path)}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg.slice(0, 300))}`;


/** Seller Central pages: verified sellers only; everyone else goes to their application status (or registration). */
export async function requireSeller(returnTo: string): Promise<Session> {
  const session = await requireCustomer(returnTo);
  if (!isSeller(session)) redirect('/account');
  return session;
}
