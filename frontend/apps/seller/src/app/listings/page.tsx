import { load } from '@ac/bff';
import { MyListingsSchema, productImageUrl } from '@ac/contracts';
import { Button, Card, DataTable, fmtDate, fmtMoney, Notice, ProductImage, StatusBadge, TextLink, type Tone, Unavailable } from '@ac/ui';
import { SellerNav, SellerPage } from '../../lib/nav';
import { requireSeller } from '../../lib/seller';

export const dynamic = 'force-dynamic';
const OFFER: Record<string, { tone: Tone; label: string }> = { ACTIVE: { tone: 'good', label: 'Active' }, INACTIVE: { tone: 'neutral', label: 'Inactive' }, PENDING_PRODUCT: { tone: 'warning', label: 'Waiting for product approval' } };
const PRODUCT: Record<string, { tone: Tone; label: string }> = { PENDING_REVIEW: { tone: 'warning', label: 'In review' }, PUBLISHED: { tone: 'good', label: 'Live' }, REJECTED: { tone: 'critical', label: 'Rejected' }, DELISTED: { tone: 'neutral', label: 'Delisted' } };

/** Catalog (catalog service GET /v1/sellers/me/listings): my offers + product pages I created. */
export default async function Listings({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const session = await requireSeller('/seller/listings');
  const { ok } = await searchParams;
  const l = await load(MyListingsSchema, '/api/catalog/v1/sellers/me/listings');
  return (
    <div>
      <SellerNav current="/seller/listings" name={session.name} />
      <SellerPage title="Manage your catalogue" crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Catalog' }]}>
        {ok && <Notice tone="success">{ok}</Notice>}
        <p className="flex flex-wrap gap-2">
          <Button href="/seller/listings/new" variant="primary">
            Add a product
          </Button>
          <Button href="/shop">Sell an existing product</Button>
          <Button href="/seller/fees">Fee calculator</Button>
        </p>
        {!l.ok ? (
          <Unavailable what="Catalog" reason={l.error} />
        ) : (
          <>
            <Card title={`Your offers (${l.data.offers.length})`}>
              <DataTable
                caption="Your offers"
                empty="You are not selling anything yet."
                rows={l.data.offers}
                columns={[
                  { key: 'img', label: 'Image', render: (o) => <ProductImage src={productImageUrl(o.productId, 'thumb')} category={o.category} title={o.title} box={48} className="border border-[var(--line)]" /> },
                  { key: 't', label: 'Product', render: (o) => <TextLink href={`/shop/p/${o.productId}`}>{o.title}</TextLink> },
                  { key: 'b', label: 'Brand', render: (o) => o.brand },
                  { key: 'sku', label: 'SKU', render: (o) => <code className="text-[12px]">{o.sellerSku}</code> },
                  { key: 'p', label: 'Price', align: 'right', render: (o) => fmtMoney(o.priceMinor, l.data.currency) },
                  { key: 's', label: 'Status', render: (o) => <StatusBadge tone={OFFER[o.status]?.tone ?? 'neutral'}>{OFFER[o.status]?.label ?? o.status}</StatusBadge> },
                  { key: 'd', label: 'Added', align: 'right', render: (o) => fmtDate(o.createdAt) },
                ]}
              />
            </Card>
            <Card title={`Product pages you created (${l.data.products.length})`}>
              <DataTable
                caption="Product pages you created"
                empty="You have not created any product pages."
                rows={l.data.products}
                columns={[
                  { key: 'img', label: 'Image', render: (p) => <ProductImage src={productImageUrl(p.productId, 'thumb')} category={p.category} title={p.title} box={48} className="border border-[var(--line)]" /> },
                  { key: 't', label: 'Product', render: (p) => (p.status === 'PUBLISHED' ? <TextLink href={`/shop/p/${p.productId}`}>{p.title}</TextLink> : p.title) },
                  { key: 'b', label: 'Brand', render: (p) => p.brand },
                  { key: 's', label: 'Status', render: (p) => <StatusBadge tone={PRODUCT[p.status]?.tone ?? 'neutral'}>{PRODUCT[p.status]?.label ?? p.status}</StatusBadge> },
                  { key: 'n', label: 'Moderation note', render: (p) => <span className="text-[13px]">{p.moderationNote ?? '—'}</span> },
                  { key: 'd', label: 'Created', align: 'right', render: (p) => fmtDate(p.createdAt) },
                  { key: 'ph', label: 'Photos', render: (p) => <TextLink href={`/seller/listings/${p.productId}/images`}>Manage photos</TextLink> },
                ]}
              />
            </Card>
          </>
        )}
      </SellerPage>
    </div>
  );
}
