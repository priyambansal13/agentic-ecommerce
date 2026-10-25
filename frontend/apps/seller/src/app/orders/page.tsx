import { load } from '@ac/bff';
import { SellerOrderListSchema, ShipInputSchema, productImageUrl } from '@ac/contracts';
import { EmptyState, fmtDate, fmtMoney, Glyph, Notice, ProductImage, Select, StatusBadge, SubmitButton, Tabs, Unavailable, Input } from '@ac/ui';
import { requireSeller } from '../../lib/seller';
import { SellerNav, SellerPage } from '../../lib/nav';
import { confirmShipment } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Manage Orders · Seller Central' };

const TABS = [
  { id: 'unshipped', label: 'Unshipped', status: 'CONFIRMED' },
  { id: 'pending', label: 'Pending payment', status: 'PENDING_PAYMENT' },
  { id: 'shipped', label: 'Shipped', status: 'SHIPPED' },
  { id: 'delivered', label: 'Delivered', status: 'DELIVERED' },
  { id: 'cancelled', label: 'Cancelled', status: 'CANCELLED' },
] as const;
const CARRIERS = ShipInputSchema.shape.carrier.options;

function shipBy(iso: string) {
  const h = (Date.parse(iso) - Date.now()) / 3_600_000;
  if (h < 0) return <StatusBadge tone="critical">Late by {Math.ceil(-h)} h</StatusBadge>;
  if (h < 12) return <StatusBadge tone="warning">Ship within {Math.max(1, Math.floor(h))} h</StatusBadge>;
  return <StatusBadge tone="neutral">Ship by {fmtDate(iso)}</StatusBadge>;
}

/** Manage Orders (order service GET /v1/sellers/me/orders): confirm shipment with carrier + tracking no. */
export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const session = await requireSeller('/seller/orders');
  const tab = TABS.find((t) => t.id === sp.tab) ?? TABS[0];
  const raw = await load(SellerOrderListSchema, `/api/order/v1/sellers/me/orders?status=${tab.status}`);
  // keep each tab exact even if the service returns a broader list
  const res = raw.ok ? { ...raw, data: { ...raw.data, items: raw.data.items.filter((i) => i.status === tab.status) } } : raw;
  return (
    <>
      <SellerNav current="/seller/orders" name={session.name} />
      <SellerPage title="Manage Orders" crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Orders' }]} intro="Ship within 48 hours of the order to keep your late-shipment rate under 4 %. Buyers get an email with the tracking number.">
        {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
        {sp.err && <Notice tone="error">{sp.err}</Notice>}
        <Tabs active={tab.id} tabs={TABS.map((t) => ({ id: t.id, label: t.label, href: `/seller/orders?tab=${t.id}`, count: t.id === tab.id && res.ok ? res.data.items.length : undefined }))} />
        {!res.ok ? (
          <Unavailable what="Orders" reason={res.error} />
        ) : res.data.items.length === 0 ? (
          <EmptyState icon={Glyph.box} title={`No ${tab.label.toLowerCase()} orders`} text={tab.id === 'unshipped' ? 'New paid orders appear here, ready to ship.' : undefined} />
        ) : (
          <ul className="space-y-3">
            {res.data.items.map((o) => (
              <li key={o.sellerOrderId} className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
                <header className="flex flex-wrap items-center gap-x-8 gap-y-1 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-[12px] text-[var(--muted)]">
                  <span>
                    ORDER <b className="text-[var(--fg)]">{o.orderNo}</b>
                  </span>
                  <span>Placed {new Date(o.placedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  {o.buyerCity && <span>Ship to {o.buyerCity}</span>}
                  <span>Total {fmtMoney(o.totalMinor, res.data.currency)}</span>
                  <span className="ml-auto">{o.status === 'CONFIRMED' ? shipBy(o.shipBy) : <StatusBadge tone={o.status === 'CANCELLED' ? 'critical' : o.status === 'DELIVERED' ? 'good' : 'neutral'}>{o.status.toLowerCase().replaceAll('_', ' ')}</StatusBadge>}</span>
                </header>
                <div className="flex flex-col gap-4 p-4 md:flex-row">
                  <ul className="flex-1 space-y-2">
                    {o.lines.map((l, i) => (
                      <li key={`${l.productId}-${i}`} className="flex items-center gap-3 text-[14px]">
                        <ProductImage src={productImageUrl(l.productId, 'thumb')} category="home" title={l.title} box={56} />
                        <span>
                          <span className="line-clamp-2">{l.title}</span>
                          <span className="text-[12px] text-[var(--muted)]">
                            Qty {l.qty} · {fmtMoney(l.unitPriceMinor, res.data.currency)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="md:w-[22rem]">
                    {o.status === 'CONFIRMED' ? (
                      <form action={confirmShipment} className="space-y-2 text-[13px]">
                        <input type="hidden" name="sellerOrderId" value={o.sellerOrderId} />
                        <input type="hidden" name="tab" value={tab.id} />
                        <div className="grid grid-cols-2 gap-2">
                          <label>
                            Carrier
                            <Select name="carrier" defaultValue="Delhivery">
                              {CARRIERS.map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </Select>
                          </label>
                          <label>
                            Tracking no.
                            <Input name="trackingNo" required minLength={8} maxLength={20} pattern="[A-Za-z0-9]{8,20}" placeholder="e.g. DL123456789IN" spellCheck={false} />
                          </label>
                        </div>
                        <SubmitButton className="w-full">Confirm shipment</SubmitButton>
                      </form>
                    ) : o.trackingNo ? (
                      <p className="text-[13px]">
                        {o.carrier} · <span className="font-mono">{o.trackingNo}</span>
                      </p>
                    ) : o.status === 'PENDING_PAYMENT' ? (
                      <p className="text-[13px] text-[var(--muted)]">Waiting for the buyer’s payment — don’t ship yet.</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SellerPage>
    </>
  );
}
