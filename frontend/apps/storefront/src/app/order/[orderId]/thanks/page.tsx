import { load } from '@ac/bff';
import { OrderDetailSchema, productImageUrl } from '@ac/contracts';
import { Button, fmtMoney, Notice, ProductImage } from '@ac/ui';
import { notFound } from 'next/navigation';
import { deliveryWindow, requireBuyer, UUID } from '../../../../lib/shop';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Thank you · agentic.commerce' };

/** "Order placed, thank you!" — after the payment webhook confirmed the order. */
export default async function ThanksPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  await requireBuyer(`/shop/order/${orderId}/thanks`);
  let r = await load(OrderDetailSchema, `/api/order/v1/orders/${orderId}`);
  // right after the payment webhook the order service is busy confirming — one short retry
  if (!r.ok && r.status !== 404 && r.status !== 403) {
    await new Promise((res) => setTimeout(res, 1200));
    r = await load(OrderDetailSchema, `/api/order/v1/orders/${orderId}`);
  }
  if (!r.ok && r.status === 404) notFound();
  if (!r.ok)
    return (
      <main className="mx-auto max-w-[900px] px-4 py-6">
        <Notice tone="success" title="Payment received">
          Your order details are loading slowly — find it in <a className="text-[var(--link)] underline" href="/account/orders">Your Orders</a>.
        </Notice>
      </main>
    );
  const o = r.data;
  const confirmed = ['PAID', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED'].includes(o.status);
  const lines = o.sellerOrders.flatMap((s) => s.lines.map((l) => ({ ...l, sellerName: s.sellerName })));
  return (
    <main className="mx-auto max-w-[900px] space-y-4 px-4 py-6">
      <section className="space-y-3 rounded-[var(--radius)] bg-[var(--card)] p-5">
        <h1 className="flex items-center gap-2 text-[22px] font-bold text-[var(--success)]">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--success)] text-[15px] text-white">
            ✓
          </span>
          {confirmed ? 'Order placed, thank you!' : 'We received your order'}
        </h1>
        <p className="text-[14px]">
          {confirmed ? 'Confirmation will be sent to your email.' : 'We are confirming your payment — this page updates in Your Orders.'} Order <b>{o.orderNo}</b> · {fmtMoney(o.totalMinor, o.currency)}
        </p>
        {o.shippingAddress && (
          <p className="text-[14px]">
            <b>Shipping to {o.shippingAddress.name},</b> {o.shippingAddress.line1}, {o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.pincode}
          </p>
        )}
        <p className="text-[16px] font-bold">Arriving {deliveryWindow(new Date(o.placedAt))}</p>
        <ul className="flex flex-wrap gap-3">
          {lines.map((l, i) => (
            <li key={`${l.productId}-${i}`} className="flex w-[160px] flex-col gap-1 text-[12px]">
              <ProductImage src={productImageUrl(l.productId, 'card')} category="home" title={l.title} box={120} />
              <span className="line-clamp-2">{l.title}</span>
              <span className="text-[var(--muted)]">
                Qty {l.qty} · {l.sellerName}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
          <Button href={`/account/orders/${o.orderId}`} variant="primary">
            Review or edit your order
          </Button>
          <Button href="/shop">Continue shopping</Button>
        </div>
      </section>
    </main>
  );
}
