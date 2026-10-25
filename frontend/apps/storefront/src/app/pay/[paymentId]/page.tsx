import { load } from '@ac/bff';
import { PaymentViewSchema } from '@ac/contracts';
import { fmtMoney, Notice } from '@ac/ui';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireBuyer, shopUrl, UUID } from '../../../lib/shop';
import { PayForm } from './pay-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pay · agentic.commerce' };

/** agentic pay (TEST MODE): pay for an order with a test card. The payment service decides via a signed webhook. */
export default async function PayPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  if (!UUID.test(paymentId)) notFound();
  await requireBuyer(`/shop/pay/${paymentId}`);
  const r = await load(PaymentViewSchema, `/api/payment/v1/payments/${paymentId}`);
  if (!r.ok && r.status === 404) notFound();
  if (!r.ok)
    return (
      <main className="mx-auto max-w-[640px] px-4 py-6">
        <Notice tone="error" title="Payment is unavailable right now">
          {r.error}. Nothing was charged — your items stay reserved until the timer runs out. Refresh in a moment.
        </Notice>
      </main>
    );
  const p = r.data;
  if (p.status === 'SUCCEEDED') redirect(shopUrl(`/order/${p.orderId}/thanks`));
  const amount = fmtMoney(p.amountMinor, p.currency);
  return (
    <main className="mx-auto max-w-[640px] space-y-4 px-4 py-6">
      <div role="note" className="rounded-[var(--radius)] border-2 border-dashed border-[var(--status-warning)] bg-[var(--card)] p-3 text-center text-[13px] font-bold">
        TEST MODE — no real card is charged and no money moves
      </div>
      <section className="space-y-4 rounded-[var(--radius)] bg-[var(--card)] p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-3">
          <h1 className="text-[22px]">
            agentic <span className="text-[var(--accent)]">pay</span>
          </h1>
          <p className="text-[14px]">
            Order {p.orderNo} · <b>{amount}</b>
          </p>
        </header>
        {p.status === 'REQUIRES_PAYMENT' || p.status === 'PROCESSING' ? (
          <PayForm paymentId={p.paymentId} orderId={p.orderId} amountText={amount} expiresAt={p.expiresAt} initialFailure={p.failureReason} idem={randomUUID()} />
        ) : (
          <Notice tone="error" title={p.status === 'CANCELED' ? 'This payment was cancelled' : 'This payment failed'}>
            {p.failureReason ?? 'The order was not paid.'} Nothing was charged{p.status === 'FAILED' ? ' and your items are back in your cart' : ''}.{' '}
            <a className="text-[var(--link)] underline" href="/shop/cart">
              Return to cart
            </a>{' '}
            · <a className="text-[var(--link)] underline" href={`/account/orders/${p.orderId}`}>View the order</a>
          </Notice>
        )}
      </section>
      <p className="text-center text-[12px] text-[var(--muted)]">Card details go to the payment service only and are never stored by agentic.commerce.</p>
    </main>
  );
}
