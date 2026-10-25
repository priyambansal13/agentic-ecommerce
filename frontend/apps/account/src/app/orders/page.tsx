import { load } from '@ac/bff';
import { BuyAgainSchema, BuyerReturnsDashboardSchema, productImageUrl } from '@ac/contracts';
import { Breadcrumb, Button, Forbidden, fmtMoney, Page, ProductImage, Tabs, TextLink, Unavailable } from '@ac/ui';
import { OrderCard } from '../../components/order-card';
import { OrdersPageSchema } from '../../lib/orders';
import { requireBuyer } from '../../lib/session';

export const dynamic = 'force-dynamic';

const RANGES = { '3m': 'past 3 months', '6m': 'past 6 months', '12m': 'past year' } as const;
type Range = keyof typeof RANGES;
type Tab = 'all' | 'buy-again' | 'not-shipped' | 'cancelled';

/** "Your Orders": tabs Orders · Buy Again · Not Yet Shipped · Cancelled, time range, paging. */
export default async function YourOrders({ searchParams }: { searchParams: Promise<{ tab?: string; range?: string; page?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (['all', 'buy-again', 'not-shipped', 'cancelled'] as const).find((t) => t === sp.tab) ?? 'all';
  const range: Range = (['3m', '6m', '12m'] as const).find((r) => r === sp.range) ?? '3m';
  const page = Math.max(1, Number(sp.page) || 1);
  const { session, ok } = await requireBuyer(`/account/orders?tab=${tab}`);
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;

  const listTab = tab === 'buy-again' ? 'all' : tab;
  const [orders, again, returns] = await Promise.all([
    load(OrdersPageSchema, `/api/order/v1/orders/mine?tab=${listTab}&range=${range}&page=${page}`),
    tab === 'buy-again' ? load(BuyAgainSchema, '/api/order/v1/orders/mine/buy-again') : Promise.resolve(null),
    load(BuyerReturnsDashboardSchema, '/api/returns/v1/dashboard/buyer'),
  ]);
  const byOrder = new Map(returns.ok ? returns.data.cases.map((c) => [c.orderNo, c]) : []);
  const href = (t: Tab, p = 1, r: Range = range) => `/account/orders?tab=${t}&range=${r}&page=${p}`;
  const counts = orders.ok ? orders.data.counts : null;
  const pages = orders.ok ? Math.max(1, Math.ceil(orders.data.total / orders.data.pageSize)) : 1;

  return (
    <Page title="Your Orders">
      <Breadcrumb items={[{ href: '/account', label: 'Your Account' }, { label: 'Your Orders' }]} />
      <Tabs
        active={tab}
        tabs={[
          { id: 'all', label: 'Orders', href: href('all'), count: counts?.all },
          { id: 'buy-again', label: 'Buy Again', href: href('buy-again') },
          { id: 'not-shipped', label: 'Not Yet Shipped', href: href('not-shipped'), count: counts?.notShipped },
          { id: 'cancelled', label: 'Cancelled Orders', href: href('cancelled'), count: counts?.cancelled },
        ]}
      />

      {tab === 'buy-again' ? (
        again && again.ok ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {again.data.items.map((i) => (
              <div key={i.productId} className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
                <a href={`/shop/p/${i.productId}`} aria-hidden tabIndex={-1} className="block rounded-md bg-white p-2">
                  <ProductImage src={productImageUrl(i.productId, 'card')} category={i.category} title={i.title} box="fill" />
                </a>
                <TextLink href={`/shop/p/${i.productId}`} className="line-clamp-2 block text-[14px]">
                  {i.title}
                </TextLink>
                <p className="text-[18px]">{fmtMoney(i.lastPriceMinor, again.data.currency)}</p>
                <p className="text-[12px] text-[var(--muted)]">
                  Ordered {i.timesOrdered}× · last on {new Date(i.lastOrderedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
                <Button href={`/shop/p/${i.productId}`} variant="primary" className="w-full">
                  Buy it again
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Unavailable what="Buy Again" reason={again && !again.ok ? again.error : 'not loaded'} />
        )
      ) : orders.ok ? (
        <>
          <form method="get" className="flex flex-wrap items-center gap-2 text-[14px]">
            <input type="hidden" name="tab" value={tab} />
            <span>
              <b>{orders.data.total} orders</b> placed in
            </span>
            <select name="range" defaultValue={range} className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1">
              {Object.entries(RANGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1">Go</button>
          </form>
          {orders.data.orders.length === 0 && <p className="text-[14px] text-[var(--muted)]">No orders here for this period.</p>}
          <div className="space-y-4">
            {orders.data.orders.map((o) => (
              <OrderCard key={o.orderNo} order={o} currency={orders.data.currency} refund={byOrder.get(o.orderNo)} />
            ))}
          </div>
          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-center gap-1 text-[14px]">
              {page > 1 && <Button href={href(tab, page - 1)}>← Previous</Button>}
              <span className="px-3 text-[var(--muted)]">
                Page {page} of {pages}
              </span>
              {page < pages && <Button href={href(tab, page + 1)}>Next →</Button>}
            </nav>
          )}
        </>
      ) : (
        <Unavailable what="Your orders" reason={orders.error} />
      )}
    </Page>
  );
}
