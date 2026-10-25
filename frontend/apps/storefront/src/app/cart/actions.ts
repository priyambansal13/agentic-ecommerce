'use server';
import { cartAdd, cartSetQty } from '@ac/bff';
import { CartSchema } from '@ac/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { shopUrl, UUID } from '../../lib/shop';

const qtyOf = (v: FormDataEntryValue | null, min: number) => Math.max(min, Math.min(10, Math.trunc(Number(v) || 0)));

/** Product page: "Add to Cart" (→ cart) or "Buy Now" (→ checkout). */
export async function addToCart(fd: FormData) {
  const offerId = String(fd.get('offerId') ?? '');
  const productId = String(fd.get('productId') ?? '');
  const back = UUID.test(productId) ? `/p/${productId}` : '';
  if (!UUID.test(offerId)) redirect(shopUrl(`${back}?err=${encodeURIComponent('Choose a seller offer first.')}`));
  const r = await cartAdd(CartSchema, offerId, qtyOf(fd.get('qty'), 1));
  if (!r.ok) redirect(shopUrl(`${back}?err=${encodeURIComponent(r.error)}`));
  revalidatePath('/', 'layout');
  redirect(shopUrl(fd.get('intent') === 'buy' ? '/checkout' : `/cart?added=${offerId}`));
}

/** Cart page: change quantity (0 = delete). */
export async function setQty(fd: FormData) {
  const offerId = String(fd.get('offerId') ?? '');
  if (!UUID.test(offerId)) redirect(shopUrl('/cart'));
  const r = await cartSetQty(CartSchema, offerId, fd.get('intent') === 'delete' ? 0 : qtyOf(fd.get('qty'), 0));
  revalidatePath('/', 'layout');
  redirect(shopUrl(r.ok ? '/cart' : `/cart?err=${encodeURIComponent(r.error)}`));
}
