import { load, loadPublic } from '@ac/bff';
import { OrderDetailSchema, RefundPolicySchema } from '@ac/contracts';
import { Breadcrumb, Button, Forbidden, Notice, Unavailable } from '@ac/ui';
import { randomUUID } from 'node:crypto';
import { requireBuyer } from '../../../lib/session';
import { ReturnForm, type ReturnableLine } from './return-form';

export const dynamic = 'force-dynamic';
const ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ORD-[A-Z0-9-]{3,30})$/i;
const RETURNABLE = ['DELIVERED', 'SHIPPED', 'PARTIALLY_SHIPPED'];

/** "Return or replace items" for one order (order service for the items, returns service for the policy). */
export default async function NewReturn({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId = '' } = await searchParams;
  const { session, ok } = await requireBuyer(`/account/returns/new?orderId=${encodeURIComponent(orderId)}`);
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;
  const crumbs = <Breadcrumb items={[{ href: '/account', label: 'Your Account' }, { href: '/account/orders', label: 'Your Orders' }, { label: 'Return or replace items' }]} />;
  if (!ID.test(orderId)) {
    return (
      <main className="mx-auto max-w-[900px] space-y-4 px-4 py-4">
        {crumbs}
        <Notice tone="info" title="Choose an order first">
          Open <a className="text-[var(--link)] underline" href="/account/orders">Your Orders</a> and pick “Return or replace items” on a delivered order.
        </Notice>
      </main>
    );
  }
  const [order, policy] = await Promise.all([load(OrderDetailSchema, `/api/order/v1/orders/${encodeURIComponent(orderId)}`), loadPublic(RefundPolicySchema, '/api/returns/v1/refund-policy')]);
  if (!order.ok) {
    return (
      <main className="mx-auto max-w-[900px] space-y-4 px-4 py-4">
        {crumbs}
        {order.status === 404 ? <Notice tone="error" title="Order not found">We couldn’t find this order in your account.</Notice> : <Unavailable what="Your order" reason={order.error} />}
      </main>
    );
  }
  const o = order.data;
  const lines: ReturnableLine[] = o.sellerOrders
    .filter((s) => s.status !== 'CANCELLED')
    .flatMap((s) => s.lines.map((l) => ({ productId: l.productId, title: l.title, qty: l.qty, unitPriceMinor: l.unitPriceMinor, sellerName: s.sellerName })));
  // return windows from the live policy: default ('*') + the categories that differ
  const win = policy.ok ? policy.data.returnWindowDays : {};
  const dflt = win['*'];
  const groups = new Map<number, string[]>();
  for (const [cat, days] of Object.entries(win)) if (cat !== '*' && days !== dflt) groups.set(days, [...(groups.get(days) ?? []), cat]);

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-4">
      {crumbs}
      <h1 className="text-[28px] leading-tight">Return or replace items</h1>
      <p className="text-[14px] text-[var(--muted)]">
        Order # {o.orderNo} · placed {new Date(o.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      {!RETURNABLE.includes(o.status) ? (
        <Notice tone="warning" title="This order can’t be returned yet">
          Returns open once your order has shipped. <Button href={`/account/orders/${o.orderId}`}>View order details</Button>
        </Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-5">
            <ReturnForm orderId={o.orderId} attempt={randomUUID()} currency={o.currency} lines={lines} />
          </section>
          <aside className="h-fit space-y-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
            <h2 className="font-bold">What happens next</h2>
            <ol className="list-decimal space-y-2 pl-5">
              <li>We check your request against our return policy — most clear-cut cases are decided within minutes.</li>
              <li>If we need more information, we’ll ask you on the return’s page.</li>
              <li>Refunds go back to your original payment method once approved.</li>
            </ol>
            {policy.ok && dflt !== undefined ? (
              <div className="space-y-1 border-t border-[var(--line)] pt-2 text-[13px] text-[var(--muted)]">
                <p>Most items can be returned within {dflt} days of delivery.</p>
                {[...groups.entries()].map(([days, cats]) => (
                  <p key={days}>{days === 0 ? `${cats.join(', ')}: no change-of-mind returns — damaged or wrong items are replaced or credited.` : `${cats.join(', ')}: ${days} days.`}</p>
                ))}
                <p>Damaged or wrong items can still be reported after the window.</p>
              </div>
            ) : (
              <p className="border-t border-[var(--line)] pt-2 text-[13px] text-[var(--muted)]">Return windows depend on the category.</p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
