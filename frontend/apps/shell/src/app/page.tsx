import { getSession, hasRole, loadPublic } from '@ac/bff';
import { CategoriesSchema, categoryImageUrl, ProductSearchSchema, productImageUrl } from '@ac/contracts';
import { CategoryCard, fmtMoney, Glyph, HeroCarousel, ProductCard, Shelf, type Slide, ZoneLink } from '@ac/ui';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

type Card = z.infer<typeof ProductSearchSchema>['items'][number];

/** Role → dashboard (each lives in the zone that owns that domain). */
const DASHBOARDS = [
  { role: 'buyer', href: '/account', label: 'Your orders & returns', icon: Glyph.box },
  { role: 'seller', href: '/seller', label: 'Seller Central', icon: Glyph.store },
  { role: 'buyer', href: '/seller/register', label: 'Sell on agentic.commerce', icon: Glyph.tag, hideFor: 'seller' },
  { role: 'admin', href: '/admin', label: 'Platform overview', icon: Glyph.chart },
  { role: 'support', href: '/admin/support', label: 'Refund approvals', icon: Glyph.refund },
  { role: 'finance', href: '/admin/finance', label: 'Payments, payouts, ledger', icon: Glyph.money },
  { role: 'fraud-analyst', href: '/admin/fraud', label: 'Fraud alerts & risk', icon: Glyph.alert },
  { role: 'moderator', href: '/admin/moderation', label: 'Listing moderation', icon: Glyph.gavel },
  { role: 'compliance', href: '/admin/compliance', label: 'Seller verification (KYC)', icon: Glyph.shield },
  { role: 'brand-team', href: '/admin/brands', label: 'Brand Registry', icon: Glyph.star },
  { role: 'category-team', href: '/admin/categories', label: 'Category approvals', icon: Glyph.check },
  { role: 'finance', href: '/admin/fees', label: 'Fee schedule (maker)', icon: Glyph.percent },
  { role: 'admin', href: '/admin/fees', label: 'Fee schedule (checker)', icon: Glyph.percent },
];

const PITCH: Record<string, string> = {
  electronics: 'Headphones, speakers, chargers and smartwatches from verified sellers.',
  outdoor: 'Gear up for the trail — shoes, packs, lanterns and more.',
  home: 'Dinner sets, lamps and linen to make it yours.',
  fashion: 'Shirts, jackets, kurtas and sneakers for every day.',
  grocery: 'Chai, honey, rice and dry fruit from licensed sellers.',
  beauty: 'Skin and hair care from licensed brands.',
  books: 'Bestsellers, classics and new releases.',
  jewellery: 'Hallmarked gold and silver.',
};

const shopHref = (dept: string) => `/shop?dept=${encodeURIComponent(dept)}`;

export default async function Home() {
  const session = await getSession();
  const cats = await loadPublic(CategoriesSchema, '/api/catalog/v1/categories');
  const categories = cats.ok ? cats.data.categories : [];
  const shelves = await Promise.all(categories.map((c) => loadPublic(ProductSearchSchema, `/api/catalog/v1/products?category=${encodeURIComponent(c.id)}&page=1`)));
  const byCat = new Map(categories.map((c, i) => [c.id, shelves[i].ok ? shelves[i].data.items : []]));
  const all = [...byCat.values()].flat();
  const first = shelves.find((s) => s.ok);
  const currency = first?.ok ? first.data.currency : 'INR';
  const img = (p: Card) => (p.imageId === null ? null : productImageUrl(p.productId, 'card'));
  const deptName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  const slides: Slide[] = categories
    .filter((c) => (byCat.get(c.id)?.length ?? 0) > 0)
    .slice(0, 5)
    .map((c) => ({ image: categoryImageUrl(c.id, 'full'), title: c.name, text: PITCH[c.id] ?? `Shop ${c.name}`, href: shopHref(c.name), cta: `Shop ${c.name}` }));
  const topPicks = [...all].sort((a, b) => b.offerCount - a.offerCount || a.title.localeCompare(b.title)).slice(0, 12);
  const under999 = all.filter((p) => p.minPriceMinor < 99900).sort((a, b) => a.minPriceMinor - b.minPriceMinor).slice(0, 12);
  const deals = all
    .filter((p) => p.mrpMinor && p.mrpMinor > p.minPriceMinor)
    .sort((a, b) => b.mrpMinor! / b.minPriceMinor - a.mrpMinor! / a.minPriceMinor)
    .slice(0, 12);
  const mine = DASHBOARDS.filter((d) => hasRole(session, d.role) && !(d.hideFor && hasRole(session, d.hideFor)));
  const card = (p: Card) => (
    <ProductCard
      key={p.productId}
      compact
      href={`/shop/p/${p.productId}`}
      image={img(p)}
      category={p.category}
      title={p.title}
      priceMinor={p.minPriceMinor}
      mrpMinor={p.mrpMinor}
      currency={currency}
      footer={p.offerCount > 1 ? `${p.offerCount} sellers` : undefined}
    />
  );

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-4 pb-10 pt-4">
      {slides.length > 0 ? (
        <HeroCarousel slides={slides} />
      ) : (
        <section className="rounded-[var(--radius)] bg-[var(--nav-2)] px-6 py-10 text-white">
          <h1 className="text-[28px] font-bold">agentic.commerce</h1>
          <p className="mt-1">One marketplace, many verified sellers — with AI agents that ask before they act.</p>
          {!cats.ok && <p className="mt-2 text-[13px] text-white/80">The catalogue is unavailable right now ({cats.error}).</p>}
        </section>
      )}

      {/* Signed-in: your dashboards; signed-out: sign-in card */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 lg:col-span-1">
          {session ? (
            <>
              <h2 className="text-[19px] font-bold">Hi, {session.name.split(' ')[0]}</h2>
              <p className="mb-3 text-[13px] text-[var(--muted)]">{mine.length ? 'Jump back in:' : 'Your account has no dashboard roles.'}</p>
              <ul className="space-y-1">
                {mine.map((d) => (
                  <li key={`${d.role}-${d.href}`}>
                    <ZoneLink href={d.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[14px] hover:bg-[var(--surface-2)]">
                      <span aria-hidden className="text-[var(--muted)] [&>svg]:h-5 [&>svg]:w-5">
                        {d.icon}
                      </span>
                      {d.label}
                    </ZoneLink>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2 className="text-[19px] font-bold">Sign in for the best experience</h2>
              <ZoneLink href="/api/auth/login?realm=customers&returnTo=%2F" className="mt-3 block rounded-full bg-[var(--btn)] px-4 py-2 text-center text-[14px] text-[#0f1111] hover:brightness-95">
                Sign in securely
              </ZoneLink>
              <p className="mt-3 text-[12px] text-[var(--muted)]">
                Demo: buyer/buyer, seller/seller. Staff?{' '}
                <ZoneLink href="/api/auth/login?realm=staff&returnTo=%2F" className="text-[var(--link)] hover:underline">
                  Console sign-in
                </ZoneLink>{' '}
                (admin, support, finance, analyst, moderator, compliance, brands, category — password = username).
              </p>
            </>
          )}
        </div>
        {categories.slice(0, 3).map((c) => {
          const items = (byCat.get(c.id) ?? []).slice(0, 4);
          return (
            <CategoryCard
              key={c.id}
              title={items.length >= 4 ? `Popular in ${c.name}` : c.name}
              href={shopHref(c.name)}
              cta={`See all in ${c.name}`}
              category={c.id}
              images={items.length >= 4 ? items.map((p) => ({ src: img(p), label: p.title, href: `/shop/p/${p.productId}` })) : [{ src: categoryImageUrl(c.id, 'card'), label: c.name, href: shopHref(c.name) }]}
            />
          );
        })}
      </section>

      {topPicks.length > 0 && (
        <Shelf title="Top picks — sold by several sellers" href="/shop">
          {topPicks.map(card)}
        </Shelf>
      )}

      {categories.length > 3 && (
        <section className={`grid gap-4 sm:grid-cols-2 ${categories.length - 3 >= 5 ? 'md:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'}`} aria-label="Shop by category">
          {categories.slice(3, 11).map((c) => (
            <CategoryCard key={c.id} title={c.name} href={shopHref(c.name)} cta={c.gated ? `Shop ${c.name} · licensed sellers` : `Shop ${c.name}`} category={c.id} images={[{ src: categoryImageUrl(c.id, 'card'), label: c.name, href: shopHref(c.name) }]} />
          ))}
        </section>
      )}

      {under999.length > 0 && (
        <Shelf title={`Under ${fmtMoney(99900, currency)}`} href="/shop">
          {under999.map(card)}
        </Shelf>
      )}
      {deals.length > 0 && (
        <Shelf title="Biggest savings on M.R.P." href="/shop">
          {deals.map(card)}
        </Shelf>
      )}
      {categories
        .filter((c) => (byCat.get(c.id)?.length ?? 0) >= 4)
        .slice(0, 3)
        .map((c) => (
          <Shelf key={c.id} title={`Best of ${deptName(c.id)}`} href={shopHref(c.name)}>
            {(byCat.get(c.id) ?? []).slice(0, 12).map(card)}
          </Shelf>
        ))}
    </main>
  );
}
