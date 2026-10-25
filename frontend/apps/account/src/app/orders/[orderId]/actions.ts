'use server';
import { send } from '@ac/bff';
import { redirect } from 'next/navigation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const url = (p: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '')}/account${p}`;

/** Buyer cancels before anything shipped → order service cancels, releases stock, refunds if paid. */
export async function cancelOrder(fd: FormData) {
  const orderId = String(fd.get('orderId') ?? '');
  if (!UUID.test(orderId)) redirect(url('/orders'));
  const reason = String(fd.get('reason') ?? '').trim() || 'Changed my mind';
  const r = await send('POST', `/api/order/v1/orders/${orderId}/cancel`, { reason }, { idempotencyKey: `cancel-${orderId}` });
  redirect(url(`/orders/${orderId}?${r.ok ? `ok=${encodeURIComponent('Your order was cancelled. If you already paid, the refund is on its way.')}` : `err=${encodeURIComponent(r.status === 409 ? 'This order can no longer be cancelled — part of it has shipped.' : r.error)}`}`));
}
