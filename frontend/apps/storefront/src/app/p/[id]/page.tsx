import { loadPublic } from '@ac/bff';
import { CategoriesSchema, ProductDetailSchema, ProductSearchSchema, StockLevelsSchema, imageUrl, productImageUrl } from '@ac/contracts';
import { Breadcrumb, Button, fmtMoney, Gallery, type GalleryImage, Notice, ProductCard, Shelf, StatusBadge, TextLink } from '@ac/ui';
import { notFound } from 'next/navigation';
import { BuyBox, OfferRow } from '../../../components/buy-box';
import { deliveryWindow } from '../../../lib/shop';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Product page (catalog GET /v1/products/:id): one page per product, every seller's offer on it. */
export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  if (!UUID.test(id)) notFound();
  const res = await loadPublic(ProductDetailSchema, `/api/catalog/v1/products/${id}`);
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok)
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-6">
        <Notice tone="error" title="This product is temporarily unavailable">
          {res.error}. <TextLink href="/shop">Back to the shop</TextLink>
        </Notice>
      </main>
    );
  const p = res.data;
  const offers = [...p.offers].sort((a, b) => a.priceMinor - b.priceMinor);
  const best = offers[0];
  const [cats, related, stock] = await Promise.all([
    loadPublic(CategoriesSchema, '/api/catalog/v1/categories'),
    loadPublic(ProductSearchSchema, `/api/catalog/v1/products?category=${encodeURIComponent(p.category)}&page=1`),
    offers.length ? loadPublic(StockLevelsSchema, `/api/inventory/v1/stock?skuIds=${offers.map((o) => o.offerId).join(',')}`) : Promise.resolve(null),
  ]);
  // display stock only (inventory's cache); unknown when inventory is down → the cart/checkout still validate
  const avail = new Map(stock?.ok ? stock.data.items.map((i) => [i.skuId, i.available]) : []);
  // featured offer = lowest price that is in stock (Amazon's buy box), else the lowest price
  const featured = offers.find((o) => (avail.get(o.offerId) ?? 1) > 0) ?? best;
  const cat = (cats.ok && cats.data.categories.find((c) => c.id === p.category)?.name) || p.category.charAt(0).toUpperCase() + p.category.slice(1);
  // Gallery: the product's images (0.5.0); older catalog versions send none → try the primary-image URL, placeholder on 404
  const images: GalleryImage[] = p.images?.length
    ? p.images.map((im) => ({ thumb: imageUrl(im.imageId, 'thumb'), full: imageUrl(im.imageId, 'full'), alt: im.alt || p.title, attribution: im.attribution }))
    : p.images === undefined
      ? [{ thumb: productImageUrl(p.productId, 'thumb'), full: productImageUrl(p.productId, 'full'), alt: p.title }]
      : [];
  const more = related.ok ? related.data.items.filter((x) => x.productId !== p.productId).slice(0, 12) : [];
  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Breadcrumb items={[{ href: '/shop', label: 'Shop' }, { href: `/shop?dept=${encodeURIComponent(cat)}`, label: cat }, { label: p.brand.name }]} />
      {p.status !== 'PUBLISHED' && <Notice tone="warning">This product is not currently available for sale.</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr_18rem]">
        <div className="rounded-[var(--radius)] bg-[var(--card)] p-3 lg:sticky lg:top-4 lg:self-start">
          <Gallery images={images} category={p.category} title={p.title} />
        </div>
        <div className="space-y-3">
          <h1 className="text-[24px] leading-tight">{p.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-[14px]">
            <TextLink href={`/shop?q=${encodeURIComponent(p.brand.name)}`}>Visit the {p.brand.name} Store</TextLink>
            {p.brand.restricted && <StatusBadge tone="good">Brand Registry</StatusBadge>}
          </p>
          <hr className="border-[var(--line)]" />
          {best ? (
            <div>
              {best.mrpMinor && best.mrpMinor > best.priceMinor && <span className="mr-2 text-[24px] text-[var(--danger)]">−{Math.round((1 - best.priceMinor / best.mrpMinor) * 100)}%</span>}
              <span className="align-top text-[13px]">₹</span>
              <span className="text-[28px]">{fmtMoney(best.priceMinor, p.currency).replace('₹', '')}</span>
              {best.mrpMinor && best.mrpMinor > best.priceMinor && <p className="text-[12px] text-[var(--muted)]">M.R.P.: <span className="line-through">{fmtMoney(best.mrpMinor, p.currency)}</span></p>}
              <p className="text-[12px] text-[var(--muted)]">Inclusive of all taxes</p>
            </div>
          ) : (
            <p className="text-[18px] text-[var(--danger)]">Currently unavailable.</p>
          )}
          <hr className="border-[var(--line)]" />
          {p.bullets.length > 0 && (
            <section>
              <h2 className="text-[16px] font-bold">About this item</h2>
              <ul className="ml-5 list-disc space-y-1 text-[14px]">
                {p.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2 className="text-[16px] font-bold">Product description</h2>
            <p className="whitespace-pre-line text-[14px]">{p.description}</p>
          </section>
        </div>
        <aside className="space-y-3">
          <div className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
            {featured && p.status === 'PUBLISHED' ? (
              <BuyBox offerId={featured.offerId} productId={p.productId} priceMinor={featured.priceMinor} currency={p.currency} sellerName={featured.sellerName} available={avail.get(featured.offerId)} deliveryText={deliveryWindow()} />
            ) : (
              <p>No seller offers this product right now.</p>
            )}
          </div>
          {offers.length > 1 && (
            <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
              <h2 className="font-bold">Other sellers on agentic.commerce ({offers.length - 1})</h2>
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {offers
                  .filter((o) => o.offerId !== featured?.offerId)
                  .map((o) => (
                    <OfferRow key={o.offerId} offerId={o.offerId} productId={p.productId} priceMinor={o.priceMinor} currency={p.currency} sellerName={o.sellerName} available={p.status === 'PUBLISHED' ? avail.get(o.offerId) : 0} />
                  ))}
              </ul>
            </section>
          )}
          <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
            <p className="font-bold">Have one to sell?</p>
            <Button href={`/seller/listings/sell?productId=${p.productId}`} className="mt-2 w-full">
              Sell on agentic.commerce
            </Button>
            {p.brand.restricted && <p className="mt-2 text-[12px] text-[var(--muted)]">{p.brand.name} is in Brand Registry — only {p.brand.ownerName ?? 'the brand owner'} and authorised resellers can sell it.</p>}
          </section>
        </aside>
      </div>
      {more.length > 0 && (
        <Shelf title={`More in ${cat}`} href={`/shop?dept=${encodeURIComponent(cat)}`}>
          {more.map((x) => (
            <ProductCard
              key={x.productId}
              compact
              href={`/shop/p/${x.productId}`}
              image={x.imageId === null ? null : productImageUrl(x.productId, 'card')}
              category={x.category}
              title={x.title}
              priceMinor={x.minPriceMinor}
              mrpMinor={x.mrpMinor}
              currency={related.ok ? related.data.currency : p.currency}
            />
          ))}
        </Shelf>
      )}
    </main>
  );
}
