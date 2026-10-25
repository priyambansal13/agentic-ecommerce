import { getSession, hasRole, load, loginUrl } from '@ac/bff';
import { productImageUrl, SellerOrdersDashboardSchema, SellerSalesDashboardSchema, SellerStockDashboardSchema } from '@ac/contracts';
import { BarChart, Button, DataTable, Forbidden, fmtAge, fmtDate, fmtDay, fmtInt, fmtMoney, fmtMoneyCompact, fmtPct, HBarChart, Panel, ProductImage, SnapshotItem, SnapshotStrip, StatusBadge, type Tone, TextLink, Unavailable } from '@ac/ui';
import { redirect } from 'next/navigation';
import { SellerNav } from '../lib/nav';

export const dynamic = 'force-dynamic';

/**
 * Account health, Seller-Central style. Targets: late shipment rate < 4 % (Amazon's published target) and
 * refund rate < 10 % (our refund policy guardrail). Inputs come from order (shipping) and seller-analytics (refunds).
 */
function accountHealth(refundRate: number | null, lateRate: number | null): { tone: Tone; label: string } {
  const bad = [refundRate !== null && refundRate >= 0.1, lateRate !== null && lateRate >= 0.04].filter(Boolean).length;
  if (refundRate === null && lateRate === null) return { tone: 'neutral', label: 'Unknown' };
  return bad === 0 ? { tone: 'good', label: 'Healthy' } : bad === 1 ? { tone: 'warning', label: 'At risk' } : { tone: 'critical', label: 'Critical' };
}


/** Seller Central home (role seller). seller-analytics (sales, payouts) · inventory (stock) · order (open orders, shipping). */
export default async function SellerCentral() {
  const session = await getSession();
  if (!session) redirect(loginUrl('customers', '/seller'));
  if (session.realm !== 'customers') return <Forbidden need="a customer account with the seller role" signedInAs={session.name} />;
  // not a seller yet → application status (which sends first-timers on to /seller/register)
  if (!hasRole(session, 'seller')) redirect('/account');

  const [sales, stock, orders] = await Promise.all([
    load(SellerSalesDashboardSchema, '/api/seller-analytics/v1/dashboard/seller'),
    load(SellerStockDashboardSchema, '/api/inventory/v1/dashboard/seller'),
    load(SellerOrdersDashboardSchema, '/api/order/v1/dashboard/seller'),
  ]);
  const cur = sales.ok ? sales.data.currency : 'INR';
  const ship = orders.ok ? orders.data.shipping : undefined;
  const lateRate = ship && ship.shipped30d > 0 ? ship.lateShipped30d / ship.shipped30d : null;
  const refundRate = sales.ok ? sales.data.kpis.refundRate30d : null;
  const health = accountHealth(refundRate, lateRate);
  const lowStock = stock.ok ? stock.data.lowStock.length : 0;

  return (
    <div>
      <SellerNav current="/seller" name={session.name} />

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        {sales.ok && orders.ok ? (
          <SnapshotStrip>
            <SnapshotItem title="Sales today" value={fmtMoney(sales.data.today?.gmvMinor ?? 0, cur)} sub={`${sales.data.today?.orders ?? 0} orders · ${sales.data.today?.units ?? 0} units`} />
            <SnapshotItem title="Sales · 30 days" value={fmtMoneyCompact(sales.data.kpis.gmv30dMinor, cur)} sub={`${fmtInt(sales.data.kpis.orders30d)} orders`} href="#reports" />
            <SnapshotItem title="Open orders" value={fmtInt(ship?.unshipped ?? orders.data.toShip.length)} sub={ship ? `${ship.late} past 48 h` : undefined} href="/seller/orders" />
            <SnapshotItem title="Account health" value={<StatusBadge tone={health.tone}>{health.label}</StatusBadge>} sub="refund & late-shipment rate" href="#performance" />
            <SnapshotItem title="Payments" value={fmtMoney(sales.data.payouts.pendingMinor, cur)} sub={sales.data.payouts.nextPayoutOn ? `next transfer ${fmtDay(sales.data.payouts.nextPayoutOn)}` : undefined} href="#payments" />
            <SnapshotItem title="Inventory" value={stock.ok ? fmtInt(stock.data.totalSkus) : '—'} sub={stock.ok ? `${stock.data.outOfStock} out of stock · ${lowStock} low` : stock.error} href="/seller/inventory" />
          </SnapshotStrip>
        ) : (
          <Unavailable what="Global snapshot" reason={!sales.ok ? sales.error : !orders.ok ? orders.error : ''} />
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <Panel title="Actions" subtitle="what needs you today">
              <ul className="divide-y divide-[var(--line)] text-[14px]">
                <li className="flex items-center justify-between py-2">
                  <span>
                    <b>{orders.ok ? fmtInt(ship?.unshipped ?? orders.data.toShip.length) : '—'}</b> orders to ship{ship?.late ? <span className="text-[var(--danger)]"> · {ship.late} late</span> : null}
                  </span>
                  <Button href="/seller/orders" variant="primary">
                    Ship orders
                  </Button>
                </li>
                <li className="flex items-center justify-between py-2">
                  <span>
                    <b>{lowStock}</b> SKUs below their restock threshold
                  </span>
                  <Button href="/seller/inventory">Restock</Button>
                </li>
                <li className="flex items-center justify-between py-2">
                  <span>Grow your catalogue — add an offer to an existing product or create a new product page</span>
                  <span className="flex gap-2">
                    <Button href="/seller/listings/new">Add a product</Button>
                    <Button href="/seller/fees">Fees</Button>
                  </span>
                </li>
                <li className="flex items-center justify-between py-2">
                  <span>Refund rate {refundRate === null ? '—' : <b>{fmtPct(refundRate)}</b>} in the last 30 days (target under 10%)</span>
                  <Button href="#performance">View health</Button>
                </li>
              </ul>
            </Panel>

            <Panel title="Sales" subtitle="ordered product sales, last 30 days">
              <span id="reports" />
              {sales.ok ? (
                <BarChart ariaLabel="Daily sales, last 30 days" data={sales.data.salesByDay.map((d) => ({ label: fmtDay(d.day), value: d.value }))} format={(v) => fmtMoneyCompact(v, cur)} />
              ) : (
                <Unavailable what="Sales" reason={sales.error} />
              )}
            </Panel>

            <Panel title="Manage orders" subtitle={orders.ok ? `${orders.data.toShip.length} oldest unshipped` : undefined} action={<TextLink href="/seller/orders">Manage all orders</TextLink>}>
              <span id="orders" />
              {orders.ok ? (
                <>
                  <DataTable
                    caption="Unshipped orders"
                    empty="Nothing waiting to ship."
                    rows={orders.data.toShip}
                    columns={[
                      { key: 'date', label: 'Order date', render: (o) => fmtDate(o.placedAt) },
                      { key: 'no', label: 'Order ID', render: (o) => <TextLink href="/seller/orders">{o.orderNo}</TextLink> },
                      { key: 'items', label: 'Units', align: 'right', render: (o) => o.items },
                      { key: 'total', label: 'Order total', align: 'right', render: (o) => fmtMoney(o.totalMinor, orders.data.currency) },
                      { key: 'ship', label: 'Ship by', align: 'right', render: (o) => <StatusBadge tone={o.ageHours > 48 ? 'critical' : o.ageHours > 24 ? 'warning' : 'neutral'}>{o.ageHours > 48 ? `late ${fmtAge(o.ageHours - 48)}` : `in ${fmtAge(48 - o.ageHours)}`}</StatusBadge> },
                    ]}
                  />
                  <p className="mt-3 flex flex-wrap gap-2 text-[12px]">
                    {orders.data.byStatus.map((s) => (
                      <StatusBadge key={s.status} tone={s.status === 'DELIVERED' ? 'good' : s.status === 'CANCELLED' ? 'critical' : 'neutral'}>
                        {s.status.toLowerCase().replaceAll('_', ' ')} · {s.count}
                      </StatusBadge>
                    ))}
                  </p>
                </>
              ) : (
                <Unavailable what="Orders" reason={orders.error} />
              )}
            </Panel>
          </div>

          <aside className="space-y-4">
            <Panel title="Account Health">
              <span id="performance" />
              <p className="mb-3">
                <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
              </p>
              <dl className="space-y-2 text-[14px]">
                <div className="flex justify-between">
                  <dt>Refund rate (30 d)</dt>
                  <dd className={refundRate !== null && refundRate >= 0.1 ? 'font-bold text-[var(--danger)]' : ''}>{refundRate === null ? '—' : fmtPct(refundRate)}</dd>
                </div>
                <div className="flex justify-between text-[12px] text-[var(--muted)]">
                  <dt>target</dt>
                  <dd>under 10%</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Late shipment rate (30 d)</dt>
                  <dd className={lateRate !== null && lateRate >= 0.04 ? 'font-bold text-[var(--danger)]' : ''}>{lateRate === null ? '—' : fmtPct(lateRate)}</dd>
                </div>
                <div className="flex justify-between text-[12px] text-[var(--muted)]">
                  <dt>target</dt>
                  <dd>under 4%</dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Payments" subtitle={sales.ok && sales.data.payouts.nextPayoutOn ? `next transfer ${fmtDay(sales.data.payouts.nextPayoutOn)}` : undefined}>
              <span id="payments" />
              {sales.ok ? (
                <>
                  <p className="text-[24px] font-bold">{fmtMoney(sales.data.payouts.pendingMinor, cur)}</p>
                  <p className="mb-2 text-[12px] text-[var(--muted)]">balance for the next transfer</p>
                  <h3 className="mt-3 text-[13px] font-bold">Recent transfers</h3>
                  <ul className="divide-y divide-[var(--line)] text-[14px]">
                    {sales.data.payouts.recent.map((p) => (
                      <li key={p.paidOn} className="flex justify-between py-1.5">
                        <span>{fmtDay(p.paidOn)}</span>
                        <span className="tabular-nums">{fmtMoney(p.amountMinor, cur)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Unavailable what="Payments" reason={sales.error} />
              )}
            </Panel>

            <Panel title="Inventory" subtitle={stock.ok ? `${stock.data.totalSkus} SKUs · ${stock.data.outOfStock} out of stock` : undefined}>
              <span id="inventory" />
              {stock.ok ? (
                <DataTable
                  caption="Low stock"
                  empty="All SKUs above their thresholds."
                  rows={stock.data.lowStock}
                  columns={[
                    {
                      key: 'sku',
                      label: 'SKU',
                      render: (s) => (
                        <span className="flex items-center gap-2" title={s.title}>
                          {s.productId && <ProductImage src={productImageUrl(s.productId, 'thumb')} category="" title={s.title} box={36} className="border border-[var(--line)]" />}
                          <span>{s.sku}</span>
                        </span>
                      ),
                    },
                    { key: 'a', label: 'Available', align: 'right', render: (s) => <StatusBadge tone={s.available === 0 ? 'critical' : 'warning'}>{s.available}</StatusBadge> },
                    { key: 't', label: 'Restock at', align: 'right', render: (s) => s.threshold },
                  ]}
                />
              ) : (
                <Unavailable what="Inventory" reason={stock.error} />
              )}
            </Panel>

            <Panel title="Top products" subtitle="30 days · by sales">
              {sales.ok && sales.data.topProducts.some((p) => p.productId) && (
                <ol className="mb-3 grid grid-cols-3 gap-2" aria-label="Best sellers">
                  {sales.data.topProducts.slice(0, 3).map((p, i) => (
                    <li key={p.title} className="text-[11px]">
                      <a href={p.productId ? `/shop/p/${p.productId}` : undefined} className="block rounded-md border border-[var(--line)] bg-white p-1">
                        <ProductImage src={p.productId ? productImageUrl(p.productId, 'card') : null} category="" title={p.title} box="fill" />
                      </a>
                      <p className="mt-1 line-clamp-2">
                        <b>#{i + 1}</b> {p.title}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              {sales.ok ? <HBarChart ariaLabel="Top products" data={sales.data.topProducts.map((p) => ({ label: p.title, value: p.grossMinor }))} format={(v) => fmtMoneyCompact(v, cur)} /> : <Unavailable what="Top products" reason={sales.error} />}
            </Panel>

            <Panel title="News">
              <ul className="space-y-2 text-[13px]">
                <li>
                  <b>Coming soon · Listing copilot</b> — draft listings from your photos; you review every field before publishing.
                </li>
                <li>
                  <b>Coming soon · Refund assistant</b> — clear-cut returns under ₹2,000 resolved within policy (in testing; today every refund is reviewed by our team).
                </li>
              </ul>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
