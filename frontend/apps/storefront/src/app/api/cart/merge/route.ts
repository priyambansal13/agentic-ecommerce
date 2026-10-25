import { getSession, mergeGuestCart } from '@ac/bff';
import { shopUrl } from '../../../../lib/shop';

/** Fallback when the login-time merge did not happen (order service was down): merge, then back to the cart. */
export async function GET() {
  const s = await getSession();
  const ok = s?.realm === 'customers' ? await mergeGuestCart(s.accessToken) : false;
  return Response.redirect(shopUrl(ok ? '/cart' : '/cart?merge=failed'), 303);
}
