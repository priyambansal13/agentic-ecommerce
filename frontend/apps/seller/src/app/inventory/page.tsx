import { load, loadPublic } from '@ac/bff';
import { MyListingsSchema, StockLevelsSchema, productImageUrl } from '@ac/contracts';
import { Button, EmptyState, fmtMoney, Glyph, Input, Notice, ProductImage, StatusBadge, SubmitButton, Unavailable } from '@ac/ui';
import { requireSeller } from '../../lib/seller';
import { SellerNav, SellerPage } from '../../lib/nav';
import { setStock } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Manage Inventory · Seller Central' };

/** Manage Inventory: my offers (catalog) with available units (inventory) and inline restock. */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  const sp = await searchParams;
  const session = await requireSeller('/seller/inventory');
  const listings = await load(MyListingsSchema, '/api/catalog/v1/sellers/me/listings');
  const offers = listings.ok ? listings.data.offers.filter((o) => !sp.q || o.title.toLowerCase().includes(sp.q.toLowerCase()) || o.sellerSku.toLowerCase().includes(sp.q.toLowerCase())) : [];
  const ids = offers.slice(0, 200).map((o) => o.offerId);
  const stock = ids.length ? await loadPublic(StockLevelsSchema, `/api/inventory/v1/stock?skuIds=${ids.join(',')}`) : null;
  const avail = new Map(stock?.ok ? stock.data.items.map((i) => [i.skuId, i.available]) : []);
  const out = offers.filter((o) => avail.get(o.offerId) === 0).length;
  return (
    <>
      <SellerNav current="/seller/inventory" name={session.name} />
      <SellerPage title="Manage Inventory" crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Inventory' }]} intro="Available = on hand minus units reserved by orders waiting for payment. Setting the stock never cancels an order.">
        {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
        {sp.err && <Notice tone="error">{sp.err}</Notice>}
        {stock && !stock.ok && <Notice tone="warning" title="Stock levels are unavailable">{stock.error} — you can still set quantities.</Notice>}
        <form className="flex flex-wrap items-center gap-2" role="search">
          <Input name="q" defaultValue={sp.q} placeholder="Search title or SKU" className="!w-72" aria-label="Search inventory" />
          <SubmitButton variant="outline">Search</SubmitButton>
          <span className="ml-auto text-[13px] text-[var(--muted)]">
            {offers.length} offers{out ? ` · ${out} out of stock` : ''}
          </span>
        </form>
        {!listings.ok ? (
          <Unavailable what="Your offers" reason={listings.error} />
        ) : offers.length === 0 ? (
          <EmptyState icon={Glyph.box} title="No offers yet" text="Add a product or sell an existing one to manage its stock here." action={<Button href="/seller/listings/new" variant="primary">Add a product</Button>} />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]">
            <table className="w-full min-w-[720px] text-[13px]">
              <caption className="sr-only">Offers and stock</caption>
              <thead className="bg-[var(--surface-2)] text-left">
                <tr>
                  <th className="px-3 py-2 font-bold">Product</th>
                  <th className="px-3 py-2 font-bold">SKU</th>
                  <th className="px-3 py-2 text-right font-bold">Price</th>
                  <th className="px-3 py-2 text-right font-bold">Available</th>
                  <th className="px-3 py-2 font-bold">Set on-hand units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {offers.map((o) => {
                  const a = avail.get(o.offerId);
                  return (
                    <tr key={o.offerId}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <ProductImage src={productImageUrl(o.productId, 'thumb')} category={o.category} title={o.title} box={44} />
                          <span className="line-clamp-2">{o.title}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px]">{o.sellerSku}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(o.priceMinor, listings.data.currency)}</td>
                      <td className="px-3 py-2 text-right">
                        {a === undefined ? '—' : a === 0 ? <StatusBadge tone="critical">Out of stock</StatusBadge> : a <= 5 ? <StatusBadge tone="warning">{a} left</StatusBadge> : <span className="tabular-nums">{a}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {o.status === 'ACTIVE' ? (
                          <form action={setStock} className="flex items-center gap-2">
                            <input type="hidden" name="skuId" value={o.offerId} />
                            <Input name="onHand" type="number" min={0} max={100000} placeholder={a === undefined ? 'units' : String(a)} aria-label={`On-hand units for ${o.title}`} className="!w-24" required />
                            <SubmitButton variant="outline">Save</SubmitButton>
                          </form>
                        ) : (
                          <span className="text-[12px] text-[var(--muted)]">{o.status === 'PENDING_PRODUCT' ? 'Waiting for moderation' : 'Inactive'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SellerPage>
    </>
  );
}
