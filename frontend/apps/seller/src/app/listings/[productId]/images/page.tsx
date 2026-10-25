import { loadPublic } from '@ac/bff';
import { imageUrl, ProductDetailSchema } from '@ac/contracts';
import { Card, Credit, EmptyState, Glyph, Notice, StatusBadge, SubmitButton, TextLink, Unavailable } from '@ac/ui';
import { notFound } from 'next/navigation';
import { ImagePicker } from '../../../../components/image-picker';
import { SellerNav, SellerPage } from '../../../../lib/nav';
import { requireSeller } from '../../../../lib/seller';
import { addImages, deleteImage, reorderImages } from './actions';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Manage a product's photos (only the product creator or the brand owner may change them — catalog enforces it). */
export default async function ProductImages({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { productId } = await params;
  const { ok, err } = await searchParams;
  if (!UUID.test(productId)) notFound();
  const session = await requireSeller(`/seller/listings/${productId}/images`);
  const p = await loadPublic(ProductDetailSchema, `/api/catalog/v1/products/${productId}`);
  if (!p.ok && p.status === 404) notFound();
  const images = p.ok ? [...(p.data.images ?? [])].sort((a, b) => a.position - b.position) : [];
  const ids = images.map((i) => i.imageId);
  const orderWith = (from: number, to: number) => {
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next.join(',');
  };
  return (
    <div>
      <SellerNav current="/seller/listings" name={session.name} />
      <SellerPage
        title="Product photos"
        intro="Up to 5 photos. The first is the main image in search and on the product page. Only the product's creator or the brand owner can change them."
        crumbs={[{ href: '/seller', label: 'Seller Central' }, { href: '/seller/listings', label: 'Catalog' }, { label: 'Photos' }]}
      >
        {ok && <Notice tone="success">{ok}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        {!p.ok ? (
          <Unavailable what="Product" reason={p.error} />
        ) : (
          <>
            <Card>
              <p className="text-[16px]">
                <TextLink href={`/shop/p/${p.data.productId}`}>{p.data.title}</TextLink>{' '}
                <StatusBadge tone={p.data.status === 'PUBLISHED' ? 'good' : p.data.status === 'PENDING_REVIEW' ? 'warning' : 'neutral'}>{p.data.status.replace('_', ' ').toLowerCase()}</StatusBadge>
              </p>
              <p className="text-[13px] text-[var(--muted)]">
                {p.data.brand.name} · {images.length}/5 photos
              </p>
            </Card>
            <Card title="Current photos">
              {p.data.images === undefined ? (
                <Notice tone="warning">The catalog service does not report photos yet — try again shortly.</Notice>
              ) : images.length === 0 ? (
                <EmptyState icon={Glyph.box} title="No photos yet" text="Products with clear photos on a white background sell better. Add up to 5 below." />
              ) : (
                <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {images.map((im, i) => (
                    <li key={im.imageId} className="space-y-2 text-[12px]">
                      <div className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-white p-1 ${i === 0 ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40' : 'border-[var(--line)]'}`}>
                        <img src={imageUrl(im.imageId, 'card')} alt={im.alt || p.data.title} width={400} height={400} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                        {i === 0 && <span className="absolute left-1 top-1 rounded bg-[var(--nav)] px-1 text-[10px] text-white">MAIN</span>}
                      </div>
                      <p className="text-[var(--muted)]">
                        {im.width}×{im.height}
                        {im.attribution && (
                          <>
                            {' · '}
                            <Credit a={im.attribution} />
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {i > 0 && (
                          <form action={reorderImages}>
                            <input type="hidden" name="productId" value={productId} />
                            <input type="hidden" name="order" value={orderWith(i, 0)} />
                            <SubmitButton variant="outline">Make main</SubmitButton>
                          </form>
                        )}
                        {i > 0 && (
                          <form action={reorderImages}>
                            <input type="hidden" name="productId" value={productId} />
                            <input type="hidden" name="order" value={orderWith(i, i - 1)} />
                            <SubmitButton variant="outline" aria-label="Move earlier">
                              ←
                            </SubmitButton>
                          </form>
                        )}
                        {i < images.length - 1 && (
                          <form action={reorderImages}>
                            <input type="hidden" name="productId" value={productId} />
                            <input type="hidden" name="order" value={orderWith(i, i + 1)} />
                            <SubmitButton variant="outline" aria-label="Move later">
                              →
                            </SubmitButton>
                          </form>
                        )}
                        <form action={deleteImage}>
                          <input type="hidden" name="productId" value={productId} />
                          <input type="hidden" name="imageId" value={im.imageId} />
                          <SubmitButton variant="danger">Delete</SubmitButton>
                        </form>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            {images.length < 5 && (
              <Card title="Add photos">
                <form action={addImages} className="space-y-3">
                  <input type="hidden" name="productId" value={productId} />
                  <ImagePicker max={5 - images.length} />
                  <SubmitButton>Upload photos</SubmitButton>
                </form>
              </Card>
            )}
          </>
        )}
      </SellerPage>
    </div>
  );
}
