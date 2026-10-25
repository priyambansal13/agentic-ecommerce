import { load, loadPublic } from '@ac/bff';
import { CategoriesSchema, ProductDetailSchema, productImageUrl, SellerEligibilitySchema } from '@ac/contracts';
import { Card, fmtMoney, Notice, ProductImage, StatusBadge, TextLink, Unavailable } from '@ac/ui';
import { randomUUID } from 'node:crypto';
import { OfferForm } from '../../../components/listing-forms';
import { SellerNav, SellerPage } from '../../../lib/nav';
import { requireSeller } from '../../../lib/seller';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sell an existing product: add an offer (catalog POST /v1/offers). */
export default async function SellExisting({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  const { productId = '' } = await searchParams;
  const session = await requireSeller(`/seller/listings/sell?productId=${encodeURIComponent(productId)}`);
  const valid = UUID.test(productId);
  const [p, cats, elig] = await Promise.all([
    valid ? loadPublic(ProductDetailSchema, `/api/catalog/v1/products/${productId}`) : Promise.resolve({ ok: false as const, status: 400, error: 'no product selected' }),
    loadPublic(CategoriesSchema, '/api/catalog/v1/categories'),
    load(SellerEligibilitySchema, '/api/catalog/v1/sellers/me/eligibility'),
  ]);
  const catName = (id: string) => (cats.ok ? cats.data.categories.find((c) => c.id === id)?.name : undefined) ?? id;
  return (
    <div>
      <SellerNav current="/seller/listings" name={session.name} />
      <SellerPage title="Sell this product" crumbs={[{ href: '/seller', label: 'Seller Central' }, { href: '/seller/listings', label: 'Catalog' }, { label: 'Sell an existing product' }]}>
        {!p.ok ? (
          <Unavailable what="Product" reason={valid ? p.error : 'Open a product in the shop and choose “Sell on agentic.commerce”.'} />
        ) : (
          <>
            <Card>
              <div className="flex gap-4">
                <ProductImage src={productImageUrl(p.data.productId, 'card')} category={p.data.category} title={p.data.title} box={120} className="border border-[var(--line)]" />
                <div className="space-y-1 text-[14px]">
                  <TextLink href={`/shop/p/${p.data.productId}`} className="text-[16px]">
                    {p.data.title}
                  </TextLink>
                  <p>
                    Brand: <b>{p.data.brand.name}</b> {p.data.brand.restricted && <StatusBadge tone="warning">Brand Registry · authorised resellers only</StatusBadge>}
                  </p>
                  <p className="text-[var(--muted)]">
                    {catName(p.data.category)} · {p.data.offers.length} seller{p.data.offers.length === 1 ? '' : 's'}
                    {p.data.offers.length > 0 && ` · lowest price ${fmtMoney(Math.min(...p.data.offers.map((o) => o.priceMinor)), p.data.currency)}`}
                  </p>
                </div>
              </div>
            </Card>
            {p.data.brand.restricted && elig.ok && !elig.data.ownedBrands.includes(p.data.brand.name) && !elig.data.authorizedBrands.includes(p.data.brand.name) && (
              <Notice tone="warning" title={`${p.data.brand.name} is protected by Brand Registry`}>
                Only {p.data.brand.ownerName ?? 'the brand owner'} and resellers they authorise can sell it. Ask them to authorise your seller ID (on your <a className="text-[var(--link)] underline" href="/seller/account">Seller account</a> page).
              </Notice>
            )}
            <Card title="Your offer">
              <OfferForm productId={p.data.productId} category={p.data.category} categoryName={catName(p.data.category)} idem={randomUUID()} />
            </Card>
          </>
        )}
      </SellerPage>
    </div>
  );
}
