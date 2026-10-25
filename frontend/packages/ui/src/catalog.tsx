import type { ReactNode } from 'react';
import { fmtMoney } from './format.js';
import { ProductImage } from './images.js';

/** Amazon price: small ₹, big rupees, M.R.P. struck through and % off (only when MRP is higher). */
export function PriceTag({ minor, mrp, currency = 'INR', size = 'md' }: { minor: number; mrp?: number | null; currency?: string; size?: 'sm' | 'md' | 'lg' }) {
  const big = size === 'lg' ? 'text-[28px]' : size === 'sm' ? 'text-[18px]' : 'text-[22px]';
  const off = mrp && mrp > minor ? Math.round((1 - minor / mrp) * 100) : 0;
  return (
    <div className="leading-tight">
      <div className="whitespace-nowrap">
        {off > 0 && size !== 'sm' && <span className="mr-1 text-[var(--danger)]">-{off}%</span>}
        <span className="align-top text-[12px]">₹</span>
        <span className={`${big} tabular-nums`}>{fmtMoney(minor, currency).replace('₹', '')}</span>
        {off > 0 && size === 'sm' && <span className="ml-1 text-[12px] text-[var(--danger)]">-{off}%</span>}
      </div>
      {off > 0 && (
        <div className="whitespace-nowrap text-[12px] text-[var(--muted)]">
          M.R.P.: <span className="line-through">{fmtMoney(mrp!, currency)}</span>
        </div>
      )}
    </div>
  );
}

/** Search-result / shelf card: image on white, 2-line title, brand, price, offers. */
export function ProductCard({
  href,
  image,
  category,
  title,
  brand,
  priceMinor,
  mrpMinor,
  currency = 'INR',
  footer,
  compact = false,
}: {
  href: string;
  image: string | null;
  category: string;
  title: string;
  brand?: string;
  priceMinor: number;
  mrpMinor?: number | null;
  currency?: string;
  footer?: ReactNode;
  compact?: boolean;
}) {
  return (
    <article className="group flex h-full flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-3">
      <a href={href} aria-hidden tabIndex={-1} className="block rounded-md bg-white p-2">
        <ProductImage src={image} category={category} title={title} box="fill" className="transition-transform group-hover:scale-[1.02]" />
      </a>
      <a href={href} className={`line-clamp-2 ${compact ? 'text-[13px]' : 'text-[15px]'} leading-snug hover:text-[var(--link-hover)] hover:underline`}>
        {title}
      </a>
      {brand && <p className="text-[12px] text-[var(--muted)]">by {brand}</p>}
      <PriceTag minor={priceMinor} mrp={mrpMinor} currency={currency} size={compact ? 'sm' : 'md'} />
      {footer && <div className="mt-auto text-[12px] text-[var(--muted)]">{footer}</div>}
    </article>
  );
}

/** Horizontal shelf ("Top picks", "Under ₹999"): scrolls sideways on small screens. */
export function Shelf({ title, href, linkText = 'See more', children }: { title: string; href?: string; linkText?: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4" aria-label={title}>
      <header className="mb-3 flex items-baseline gap-4">
        <h2 className="text-[20px] font-bold">{title}</h2>
        {href && (
          <a href={href} className="text-[13px] text-[var(--link)] hover:underline">
            {linkText}
          </a>
        )}
      </header>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [&>*]:w-[160px] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-[180px]">{children}</div>
    </section>
  );
}
