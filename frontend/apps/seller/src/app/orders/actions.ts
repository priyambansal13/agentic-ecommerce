'use server';
import { send } from '@ac/bff';
import { ShipInputSchema } from '@ac/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { flash } from '../../lib/seller';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confirm shipment: carrier + tracking no. → order service (buyer gets the "shipped" email). */
export async function confirmShipment(fd: FormData) {
  const id = String(fd.get('sellerOrderId') ?? '');
  const tab = String(fd.get('tab') ?? 'unshipped');
  if (!UUID.test(id)) redirect(flash(`/orders?tab=${tab}`, 'err', 'Unknown order.'));
  const input = ShipInputSchema.safeParse({ carrier: String(fd.get('carrier') ?? ''), trackingNo: String(fd.get('trackingNo') ?? '').trim().toUpperCase() });
  if (!input.success) redirect(flash(`/orders?tab=${tab}`, 'err', `Tracking number: ${input.error.issues[0]?.message ?? 'invalid'}`));
  const r = await send('POST', `/api/order/v1/seller-orders/${id}/ship`, input.data, { idempotencyKey: `ship-${id}` });
  revalidatePath('/orders');
  redirect(flash(`/orders?tab=${tab}`, r.ok ? 'ok' : 'err', r.ok ? `Shipment confirmed — ${input.data.carrier} ${input.data.trackingNo}. The buyer has been notified.` : r.status === 409 ? 'This order was already shipped or cancelled.' : r.error));
}
