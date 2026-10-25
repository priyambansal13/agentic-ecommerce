import { load } from '@ac/bff';
import { BuyAgainSchema, BuyerReturnsDashboardSchema, productImageUrl } from '@ac/contracts';
import { AccountTile, Forbidden, Icons, Page, ProductCard, Shelf, TextLink, Unavailable } from '@ac/ui';
import { OrderCard, RETURN_TEXT } from '../components/order-card';
import { OrdersPageSchema } from '../lib/orders';
import { requireBuyer } from '../lib/session';

export const dynamic = 'force-dynamic';

/** "Your Account" — tile grid + recent orders (order service) + returns in progress (returns service). */
export default async function YourAccount() {
  const { session, ok } = await requireBuyer('/account');
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;
  const [orders, returns, again] = await Promise.all([
    load(OrdersPageSchema, '/api/order/v1/orders/mine?tab=all&range=3m&page=1'),
    load(BuyerReturnsDashboardSchema, '/api/returns/v1/dashboard/buyer'),
    load(BuyAgainSchema, '/api/order/v1/orders/mine/buy-again'),
  ]);
  const keycloakAccount = `${(process.env.AUTH_ISSUER_BASE ?? 'http://localhost:58180').replace(/\/$/, '')}/realms/customers/account`;
  const seller = session.roles.includes('seller');
  const byOrder = new Map(returns.ok ? returns.data.cases.map((c) => [c.orderNo, c]) : []);
  const openReturns = returns.ok ? returns.data.cases.filter((c) => !['REFUNDED', 'REJECTED', 'CLOSED'].includes(c.status)) : [];

  return (
    <Page title="Your Account">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AccountTile href="/account/orders" icon={Icons.box} title="Your Orders" desc="Track, return, cancel an order or buy again" />
        <AccountTile href="/account/orders?tab=buy-again" icon={Icons.again} title="Buy Again" desc="Things you ordered before, one click away" />
        <AccountTile href="/account/returns" icon={Icons.returns} title="Returns & refunds" desc={openReturns.length ? `${openReturns.length} return${openReturns.length > 1 ? 's' : ''} in progress` : 'Start a return or check a refund'} />
        <AccountTile href={keycloakAccount} icon={Icons.lock} title="Login & security" desc="Name, email, password and sessions" />
        <AccountTile href="/account/help" icon={Icons.help} title="Customer Service" desc="Get help from our assistant, any time" />
        {seller && <AccountTile href="/seller" icon={Icons.store} title="Your Seller Account" desc="Go to Seller Central" />}
      </div>

      {openReturns.length > 0 && (
        <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="mb-2 text-[18px] font-bold">Returns in progress</h2>
          <ul className="space-y-1 text-[14px]">
            {openReturns.slice(0, 4).map((c) => (
              <li key={c.caseId}>
                Order {c.orderNo} — <TextLink href={`/account/returns/${c.caseId}`}>{RETURN_TEXT[c.status] ?? 'in progress'}</TextLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {again.ok && again.data.items.length > 0 && (
        <Shelf title="Buy it again" href="/account/orders?tab=buy-again" linkText="See all">
          {again.data.items.slice(0, 10).map((i) => (
            <ProductCard
              key={i.productId}
              compact
              href={`/shop/p/${i.productId}`}
              image={productImageUrl(i.productId, 'card')}
              category={i.category}
              title={i.title}
              priceMinor={i.lastPriceMinor}
              currency={again.data.currency}
              footer={`Ordered ${i.timesOrdered}×`}
            />
          ))}
        </Shelf>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[21px] font-bold">Recent orders</h2>
          <TextLink href="/account/orders">See all orders</TextLink>
        </div>
        {orders.ok ? orders.data.orders.slice(0, 3).map((o) => <OrderCard key={o.orderNo} order={o} currency={orders.data.currency} refund={byOrder.get(o.orderNo)} />) : <Unavailable what="Your orders" reason={orders.error} />}
      </section>
    </Page>
  );
}
