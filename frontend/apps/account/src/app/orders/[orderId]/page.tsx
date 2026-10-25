import { load } from '@ac/bff';
import { type OrderDetail, OrderDetailSchema, productImageUrl } from '@ac/contracts';
import { Breadcrumb, Button, fmtDate, fmtMoney, Forbidden, Glyph, Notice, ProductImage, Select, StatusBadge, SubmitButton, TextLink, type Tone } from '@ac/ui';
import { notFound } from 'next/navigation';
import { requireBuyer } from '../../../lib/session';
import { cancelOrder } from './actions';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the order service also accepts the order number (links from order cards) */
const ORDER_NO = /^ORD-[A-Z0-9-]{3,30}$/;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const ORDER_TEXT: Record<string, { text: string; tone: Tone }> = {
  CREATED: { text: 'Order created', tone: 'neutral' },
  PENDING_PAYMENT: { text: 'Payment pending', tone: 'warning' },
  PAID: { text: 'Paid — confirming', tone: 'neutral' },
  CONFIRMED: { text: 'Confirmed', tone: 'good' },
  PARTIALLY_SHIPPED: { text: 'Partly shipped', tone: 'good' },
  SHIPPED: { text: 'Shipped', tone: 'good' },
  DELIVERED: { text: 'Delivered', tone: 'good' },
  CANCELLED: { text: 'Cancelled', tone: 'critical' },
  PAYMENT_FAILED: { text: 'Payment failed', tone: 'critical' },
  REJECTED: { text: 'Not placed', tone: 'critical' },
  RETURN_IN_PROGRESS: { text: 'Return in progress', tone: 'warning' },
  REFUNDED: { text: 'Refunded', tone: 'neutral' },
};
const REASONS = ['Changed my mind', 'Ordered by mistake', 'Found a better price', 'Delivery takes too long', 'Need to change the address'];

/** Progress tracker for one shipment: Ordered → Shipped → Out for delivery → Delivered (icon + label, not colour only). */
function Tracker({ s, placedAt }: { s: OrderDetail['sellerOrders'][number]; placedAt: string }) {
  if (s.status === 'CANCELLED') return <p className="text-[14px] font-bold text-[var(--danger)]">This shipment was cancelled.</p>;
  const steps = [
    { label: 'Ordered', done: true, at: placedAt },
    { label: 'Shipped', done: !!s.shippedAt, at: s.shippedAt },
    // the demo carrier reports only shipped/delivered, so "out for delivery" completes with delivery
    { label: 'Out for delivery', done: !!s.deliveredAt, at: null },
    { label: 'Delivered', done: !!s.deliveredAt, at: s.deliveredAt },
  ];
  const current = steps.filter((x) => x.done).length - 1;
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Delivery progress">
      {steps.map((x, i) => (
        <li key={x.label} className="flex flex-col items-center text-center text-[12px]" aria-current={i === current ? 'step' : undefined}>
          <span className="flex w-full items-center">
            <span className={`h-1 flex-1 ${i === 0 ? 'invisible' : x.done ? 'bg-[var(--success)]' : 'bg-[var(--line)]'}`} />
            <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[12px] font-bold ${x.done ? 'border-[var(--success)] bg-[var(--success)] text-white' : 'border-[var(--line)] bg-[var(--card)] text-[var(--muted)]'}`}>
              {x.done ? '✓' : i + 1}
            </span>
            <span className={`h-1 flex-1 ${i === steps.length - 1 ? 'invisible' : steps[i + 1].done ? 'bg-[var(--success)]' : 'bg-[var(--line)]'}`} />
          </span>
          <span className={`mt-1 ${i === current ? 'font-bold' : ''}`}>{x.label}</span>
          <span className="text-[11px] text-[var(--muted)]">{x.done && x.at ? day(x.at) : x.done ? '' : 'pending'}</span>
        </li>
      ))}
    </ol>
  );
}

/** Order details (order service GET /v1/orders/:id): status, shipments with tracking, address, payment, cancel. */
export default async function OrderDetailsPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { orderId } = await params;
  const sp = await searchParams;
  if (!UUID.test(orderId) && !ORDER_NO.test(orderId)) notFound();
  const { session, ok } = await requireBuyer(`/account/orders/${orderId}`);
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;
  const r = await load(OrderDetailSchema, `/api/order/v1/orders/${encodeURIComponent(orderId)}`);
  if (!r.ok && (r.status === 404 || r.status === 403)) notFound();
  const crumbs = [{ href: '/account', label: 'Your Account' }, { href: '/account/orders', label: 'Your Orders' }, { label: 'Order details' }];
  if (!r.ok)
    return (
      <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
        <Breadcrumb items={crumbs} />
        <Notice tone="error" title="Order details are unavailable right now">
          {r.error}. <TextLink href="/account/orders">Back to Your Orders</TextLink>
        </Notice>
      </main>
    );
  const o = r.data;
  const st = ORDER_TEXT[o.status] ?? { text: o.status.toLowerCase(), tone: 'neutral' as Tone };
  const pending = (o.status === 'PENDING_PAYMENT' || o.status === 'CREATED') && o.payment && o.payment.status === 'REQUIRES_PAYMENT';
  return (
    <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
      <Breadcrumb items={crumbs} />
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[28px]">Order details</h1>
          <p className="text-[14px] text-[var(--muted)]">
            Ordered on {fmtDate(o.placedAt)} · Order # {o.orderNo}
          </p>
        </div>
        <StatusBadge tone={st.tone}>{st.text}</StatusBadge>
      </header>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.err && <Notice tone="error">{sp.err}</Notice>}
      {pending && (
        <Notice tone="warning" title="Payment pending">
          Your items are held for a short time. <TextLink href={`/shop/pay/${o.payment!.paymentId}`}>Complete payment</TextLink>
        </Notice>
      )}
      {o.status === 'PAYMENT_FAILED' && <Notice tone="error" title="Payment failed">The order was not placed and nothing was charged. The items are back in stock — you can order them again from your cart.</Notice>}
      {o.status === 'REJECTED' && <Notice tone="error" title="We couldn’t place this order">Nothing was charged. <TextLink href="/account/help">Contact Customer Service</TextLink> if you need help.</Notice>}
      {o.status === 'CANCELLED' && <Notice tone="info" title="This order was cancelled">If you paid, the refund goes back to your original payment method within 5–7 business days.</Notice>}

      <section className="grid gap-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px] sm:grid-cols-3">
        <div>
          <h2 className="font-bold">Shipping address</h2>
          {o.shippingAddress ? (
            <address className="not-italic">
              {o.shippingAddress.name}
              <br />
              {o.shippingAddress.line1}
              {o.shippingAddress.line2 && (
                <>
                  <br />
                  {o.shippingAddress.line2}
                </>
              )}
              <br />
              {o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.pincode}
            </address>
          ) : (
            <p className="text-[var(--muted)]">—</p>
          )}
        </div>
        <div>
          <h2 className="font-bold">Payment method</h2>
          <p>{o.payment ? (o.payment.provider === 'testpay' ? 'Card · agentic pay (test mode)' : 'Card · Stripe') : '—'}</p>
          {o.payment && <p className="text-[12px] text-[var(--muted)]">Payment {o.payment.status.toLowerCase().replaceAll('_', ' ')}</p>}
        </div>
        <div>
          <h2 className="font-bold">Order summary</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-0.5">
            <dt>Item(s) subtotal:</dt>
            <dd className="text-right tabular-nums">{fmtMoney(o.subtotalMinor, o.currency)}</dd>
            <dt>Delivery:</dt>
            <dd className="text-right tabular-nums">{o.shippingMinor ? fmtMoney(o.shippingMinor, o.currency) : 'FREE'}</dd>
            <dt className="font-bold">Grand total:</dt>
            <dd className="text-right font-bold tabular-nums">{fmtMoney(o.totalMinor, o.currency)}</dd>
          </dl>
        </div>
      </section>

      {o.sellerOrders.map((s, i) => (
        <section key={s.sellerOrderId} className="space-y-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4" aria-label={`Shipment ${i + 1}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[18px] font-bold">
              {s.deliveredAt ? `Delivered ${day(s.deliveredAt)}` : s.shippedAt ? 'On the way' : s.status === 'CANCELLED' ? 'Cancelled' : 'Preparing for dispatch'}
            </h2>
            <span className="text-[12px] text-[var(--muted)]">
              Shipment {i + 1} of {o.sellerOrders.length} · Sold by {s.sellerName}
            </span>
          </div>
          <Tracker s={s} placedAt={o.placedAt} />
          {s.trackingNo && (
            <p className="flex items-center gap-2 text-[13px]">
              <span aria-hidden className="[&>svg]:h-5 [&>svg]:w-5">
                {Glyph.truck}
              </span>
              {s.carrier} · tracking no. <span className="font-mono">{s.trackingNo}</span>
            </p>
          )}
          <ul className="space-y-3">
            {s.lines.map((l, j) => (
              <li key={`${l.productId}-${j}`} className="flex gap-3 text-[14px]">
                <a href={`/shop/p/${l.productId}`} tabIndex={-1} aria-hidden>
                  <ProductImage src={productImageUrl(l.productId, 'thumb')} category="home" title={l.title} box={80} />
                </a>
                <div>
                  <TextLink href={`/shop/p/${l.productId}`} className="font-bold">
                    {l.title}
                  </TextLink>
                  <p className="text-[12px] text-[var(--muted)]">
                    Qty {l.qty} · {fmtMoney(l.unitPriceMinor, o.currency)}
                  </p>
                  {s.status === 'DELIVERED' && (
                    <Button href={`/shop/p/${l.productId}`} variant="primary" className="mt-1">
                      ↻ Buy it again
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        {o.canCancel && (
          <section id="cancel" className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
            <h2 className="font-bold">Cancel items</h2>
            <p className="text-[13px] text-[var(--muted)]">You can cancel until a seller ships. Paid orders are refunded automatically.</p>
            <form action={cancelOrder} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="orderId" value={o.orderId} />
              <label className="text-[13px]">
                Reason
                <Select name="reason" defaultValue={REASONS[0]}>
                  {REASONS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </label>
              <SubmitButton variant="danger">Cancel order</SubmitButton>
            </form>
          </section>
        )}
        <section className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
          <h2 className="font-bold">Order history</h2>
          <ol className="space-y-1 text-[13px]">
            {o.timeline.map((t, i) => (
              <li key={`${t.status}-${i}`} className="flex justify-between gap-3">
                <span>{(ORDER_TEXT[t.status]?.text ?? t.status.toLowerCase()).replace(' — confirming', '')}</span>
                <span className="text-[var(--muted)]">{new Date(t.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {['DELIVERED', 'SHIPPED', 'PARTIALLY_SHIPPED'].includes(o.status) && <Button href={`/account/returns/new?orderId=${o.orderId}`}>Return or replace items</Button>}
            <Button href={`/account/help?order=${encodeURIComponent(o.orderNo)}`}>Get help with this order</Button>
          </div>
        </section>
      </div>
    </main>
  );
}
