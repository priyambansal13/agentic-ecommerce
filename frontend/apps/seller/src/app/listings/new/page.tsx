import { load, loadPublic } from '@ac/bff';
import { CategoriesSchema, SellerEligibilitySchema } from '@ac/contracts';
import { Card, Notice, Unavailable } from '@ac/ui';
import { randomUUID } from 'node:crypto';
import { ProductForm } from '../../../components/listing-forms';
import { SellerNav, SellerPage } from '../../../lib/nav';
import { requireSeller } from '../../../lib/seller';

export const dynamic = 'force-dynamic';

/** Add a product (catalog service POST /v1/products) — checks eligibility up front, live fee preview from payment. */
export default async function NewProduct() {
  const session = await requireSeller('/seller/listings/new');
  const [cats, elig] = await Promise.all([loadPublic(CategoriesSchema, '/api/catalog/v1/categories'), load(SellerEligibilitySchema, '/api/catalog/v1/sellers/me/eligibility')]);
  const approved = elig.ok ? elig.data.approvedCategories : [];
  const categories = cats.ok ? cats.data.categories.map((c) => ({ ...c, allowed: !c.gated || approved.includes(c.id) })) : [];
  return (
    <div>
      <SellerNav current="/seller/listings/new" name={session.name} />
      <SellerPage
        title="Add a product"
        crumbs={[{ href: '/seller', label: 'Seller Central' }, { href: '/seller/listings', label: 'Catalog' }, { label: 'Add a product' }]}
        intro={
          <>
            Is the product already sold here? <a className="text-[var(--link)] underline" href="/shop">Search the catalogue</a> and choose “Sell on agentic.commerce” on its page — one product page, many sellers.
          </>
        }
      >
        {elig.ok && !elig.data.verified && <Notice tone="warning" title="Your account is not verified yet">You can prepare a listing, but it will be refused until compliance verifies your business.</Notice>}
        {elig.ok && (elig.data.ownedBrands.length > 0 || elig.data.authorizedBrands.length > 0) && (
          <Notice tone="info" title="Your brands">
            You own {elig.data.ownedBrands.join(', ') || 'no brands'}
            {elig.data.authorizedBrands.length ? ` · authorised to resell ${elig.data.authorizedBrands.join(', ')}` : ''}. Products of other Brand Registry brands can only be created by their owners.
          </Notice>
        )}
        {cats.ok ? (
          <Card>
            <ProductForm categories={categories} idem={randomUUID()} />
          </Card>
        ) : (
          <Unavailable what="Catalog service" reason={cats.error} />
        )}
      </SellerPage>
    </div>
  );
}
