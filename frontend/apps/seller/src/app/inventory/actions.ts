'use server';
import { send } from '@ac/bff';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { flash } from '../../lib/seller';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Restock / adjust: set on-hand units for one offer (inventory PUT /v1/sellers/me/stock/:skuId). */
export async function setStock(fd: FormData) {
  const skuId = String(fd.get('skuId') ?? '');
  const onHand = Math.trunc(Number(fd.get('onHand')));
  if (!UUID.test(skuId) || !Number.isFinite(onHand) || onHand < 0 || onHand > 100000) redirect(flash('/inventory', 'err', 'Enter a stock quantity between 0 and 100,000.'));
  const r = await send('PUT', `/api/inventory/v1/sellers/me/stock/${skuId}`, { onHand }, { idempotencyKey: `stock-${skuId}-${onHand}-${Date.now()}` });
  revalidatePath('/inventory');
  redirect(flash('/inventory', r.ok ? 'ok' : 'err', r.ok ? `Stock updated to ${onHand}.` : r.status === 422 || r.status === 409 ? `Can’t go below units already reserved by open orders: ${r.error}` : r.error));
}
