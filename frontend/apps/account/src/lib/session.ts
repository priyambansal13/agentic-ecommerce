import { getSession, hasRole, loginUrl } from '@ac/bff';
import { redirect } from 'next/navigation';

/** Buyer pages need a customers-realm session with role buyer (sellers have it too). */
export async function requireBuyer(returnTo: string) {
  const session = await getSession();
  if (!session) redirect(loginUrl('customers', returnTo));
  return { session, ok: hasRole(session, 'buyer') };
}
