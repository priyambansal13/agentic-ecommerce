import { Notice } from '@ac/ui';

/** 422 listing-rule codes → what to tell the seller and where to fix it (mirrors the catalog service rules). */
export const LISTING_HELP: Record<string, { title: string; text: string; href: string; link: string }> = {
  SELLER_NOT_VERIFIED: { title: 'Your seller account is not verified yet', text: 'You can list products once our compliance team has verified your GST, PAN and bank details.', href: '/seller/account', link: 'Check verification status' },
  CATEGORY_NOT_APPROVED: { title: 'This category needs approval', text: 'It is a gated category. Request approval with your licence number; most requests are decided within 2 business days.', href: '/seller/categories', link: 'Request category approval' },
  BRAND_RESTRICTED: { title: 'This brand is protected by Brand Registry', text: 'Only the brand owner and resellers they authorise can sell it. Share your seller ID with the brand owner and ask to be authorised.', href: '/seller/brands', link: 'See your brand authorisations' },
  BRAND_NOT_OWNED: { title: 'Only the brand owner can create products for this brand', text: 'If the product already exists in the catalogue, add your offer to it instead of creating a new page.', href: '/shop', link: 'Find the product in the catalogue' },
  PRODUCT_NOT_PUBLISHED: { title: 'This product is not live yet', text: 'Offers can only be added to published products.', href: '/shop', link: 'Browse the catalogue' },
  DUPLICATE_OFFER: { title: 'You already sell this product', text: 'Each seller has one offer per product. Update your existing offer instead.', href: '/seller/listings', link: 'Go to your catalogue' },
  PRICE_ABOVE_MRP: { title: 'Price is above the MRP', text: 'Selling above the printed MRP is not allowed (Legal Metrology rules). Lower the price or correct the MRP.', href: '#price', link: 'Fix the price' },
};

export function ListingError({ code, error }: { code?: string; error?: string }) {
  const h = code ? LISTING_HELP[code] : undefined;
  if (h)
    return (
      <Notice tone="error" title={h.title}>
        {h.text}{' '}
        <a className="font-bold text-[var(--link)] underline" href={h.href}>
          {h.link}
        </a>
      </Notice>
    );
  return error ? <Notice tone="error">{error}</Notice> : null;
}
