import { AgentChat } from '@ac/agent-widget';
import { loadPublic } from '@ac/bff';
import { CategoriesSchema, ProductSearchSchema, productImageUrl } from '@ac/contracts';
import { Breadcrumb, Button, EmptyState, fmtInt, fmtMoney, Glyph, Notice, Page, ProductCard, ProductThumb } from '@ac/ui';

export const dynamic = 'force-dynamic';

// Fallback only: shown when the catalog service is unavailable (search service with hybrid ranking arrives in P1).
const SAMPLE = [
  { title: 'Noise-cancelling headphones', category: 'electronics', priceMinor: 899900, mrpMinor: 1299900, seller: 'Nova Audio' },
  { title: 'Steel water bottle 1 L', category: 'outdoor', priceMinor: 79900, mrpMinor: 99900, seller: "Sam's Outdoor Store" },
  { title: 'Trail running shoes', category: 'outdoor', priceMinor: 459900, mrpMinor: 599900, seller: 'Peak Sports' },
  { title: 'Ceramic dinner set', category: 'home', priceMinor: 249900, mrpMinor: 349900, seller: 'Lotus Home' },
  { title: 'Linen shirt', category: 'fashion', priceMinor: 159900, mrpMinor: 199900, seller: 'Urban Threads' },
  { title: 'Masala chai 500 g', category: 'grocery', priceMinor: 34900, mrpMinor: 39900, seller: 'Chai & Co' },
  { title: 'Bluetooth speaker', category: 'electronics', priceMinor: 349900, mrpMinor: 499900, seller: 'Pixel Gadgets' },
  { title: 'Camping lantern', category: 'outdoor', priceMinor: 129900, mrpMinor: 149900, seller: "Sam's Outdoor Store" },
];

const PAGE_SIZE_HINT = 24;

function Price({ minor, mrp, cur }: { minor: number; mrp?: number | null; cur: string }) {
  return (
    <p>
      <span className="align-top text-[13px]">₹</span>
      <span className="text-[24px]">{fmtMoney(minor, cur).replace('₹', '')}</span>{' '}
      {mrp && mrp > minor ? (
        <>
          <span className="text-[12px] text-[var(--muted)] line-through">M.R.P. {fmtMoney(mrp, cur)}</span> <span className="text-[12px] text-[var(--danger)]">({Math.round((1 - minor / mrp) * 100)}% off)</span>
        </>
      ) : null}
    </p>
  );
}

/** Search results from the shared catalogue (catalog GET /v1/products — published products, lowest offer price). */
export default async function Storefront({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; page?: string }> }) {
  const { q = '', dept = 'All', page = '1' } = await searchParams;
  const pageNo = Math.max(1, Number.parseInt(page, 10) || 1);
  const qs = new URLSearchParams({ page: String(pageNo) });
  if (q) qs.set('q', q);
  if (dept !== 'All') qs.set('category', dept.toLowerCase());
  const res = await loadPublic(ProductSearchSchema, `/api/catalog/v1/products?${qs}`);
  const link = (p: number) => {
    const u = new URLSearchParams({ page: String(p) });
    if (q) u.set('q', q);
    if (dept !== 'All') u.set('dept', dept);
    return `/shop?${u}`;
  };

  if (!res.ok) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = SAMPLE.filter((p) => (dept === 'All' || p.category === dept.toLowerCase()) && words.every((w) => p.title.toLowerCase().includes(w)));
    return (
      <Page title={q ? `Results for “${q}”` : 'Shop'}>
        <Notice tone="warning" title="The catalogue is temporarily unavailable">
          Showing a small sample instead ({res.error}).
        </Notice>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {hits.map((p) => (
            <article key={p.title} className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
              <ProductThumb category={p.category} title={p.title} size={160} />
              <p className="text-[16px]">{p.title}</p>
              <Price minor={p.priceMinor} mrp={p.mrpMinor} cur="INR" />
              <p className="text-[12px] text-[var(--muted)]">Sold by {p.seller}</p>
            </article>
          ))}
        </div>
      </Page>
    );
  }

  const r = res.data;
  const pages = Math.max(1, Math.ceil(r.total / (r.pageSize || PAGE_SIZE_HINT)));
  const from = r.total === 0 ? 0 : (r.page - 1) * r.pageSize + 1;
  const to = Math.min(r.total, r.page * r.pageSize);
  // Department rail with result counts for the current query (one cheap count query per department)
  const cats = await loadPublic(CategoriesSchema, '/api/catalog/v1/categories');
  const categories = cats.ok ? cats.data.categories : [];
  const counts = await Promise.all(
    categories.map(async (c) => {
      const u = new URLSearchParams({ page: '1', category: c.id });
      if (q) u.set('q', q);
      const x = await loadPublic(ProductSearchSchema, `/api/catalog/v1/products?${u}`);
      return x.ok ? x.data.total : null;
    }),
  );
  const deptLink = (d: string) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (d !== 'All') u.set('dept', d);
    const qs = u.toString();
    return `/shop${qs ? `?${qs}` : ''}`;
  };
  const deptLabel = categories.find((c) => c.id === dept.toLowerCase())?.name ?? dept;
  return (
    <main className="mx-auto max-w-[1500px] space-y-3 px-4 pb-10 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2">
        <Breadcrumb items={dept !== 'All' ? [{ href: '/shop', label: 'All departments' }, { label: deptLabel }] : [{ label: 'All departments' }]} />
        <p className="text-[14px]" aria-live="polite">
          {r.total === 0 ? 'No' : `${from}–${to} of ${fmtInt(r.total)}`} result{r.total === 1 ? '' : 's'}
          {q ? (
            <>
              {' '}
              for <b className="text-[var(--accent-fg,#c45500)]">“{q}”</b>
            </>
          ) : null}
          {dept !== 'All' ? ` in ${deptLabel}` : ''}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <aside aria-label="Filters" className="space-y-4 text-[14px]">
          <nav aria-label="Department">
            <h2 className="mb-1 font-bold">Department</h2>
            <ul className="space-y-0.5">
              <li>
                <a href={deptLink('All')} aria-current={dept === 'All' ? 'page' : undefined} className={`block rounded px-1 py-0.5 hover:text-[var(--link-hover)] ${dept === 'All' ? 'font-bold' : ''}`}>
                  All departments
                </a>
              </li>
              {categories.map((c, i) => (
                <li key={c.id}>
                  <a
                    href={deptLink(c.name)}
                    aria-current={dept.toLowerCase() === c.id ? 'page' : undefined}
                    className={`flex justify-between gap-2 rounded px-1 py-0.5 hover:text-[var(--link-hover)] ${dept.toLowerCase() === c.id ? 'font-bold' : ''}`}
                  >
                    <span>{c.name}</span>
                    {counts[i] !== null && <span className="tabular-nums text-[var(--muted)]">{fmtInt(counts[i]!)}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-3 text-[13px]">
            <p className="font-bold">Many sellers, one page</p>
            <p className="mt-1 text-[var(--muted)]">Each product has one page; verified sellers compete on price. The lowest price is shown.</p>
          </div>
        </aside>
        <div className="space-y-4">
          {r.items.length === 0 ? (
            <EmptyState
              icon={Glyph.inbox}
              title={`No results${q ? ` for “${q}”` : ''}`}
              text={<>Check the spelling or try a broader search{dept !== 'All' ? ' in All departments' : ''}.</>}
              action={dept !== 'All' ? <Button href={deptLink('All')}>Search all departments</Button> : undefined}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {r.items.map((p) => (
                <ProductCard
                  key={p.productId}
                  href={`/shop/p/${p.productId}`}
                  image={p.imageId === null ? null : productImageUrl(p.productId, 'card')}
                  category={p.category}
                  title={p.title}
                  brand={p.brand}
                  priceMinor={p.minPriceMinor}
                  mrpMinor={p.mrpMinor}
                  currency={r.currency}
                  footer={p.offerCount > 1 ? `${p.offerCount} sellers from ${fmtMoney(p.minPriceMinor, r.currency)}` : '1 seller'}
                />
              ))}
            </div>
          )}
          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-center gap-2 text-[14px]">
              {r.page > 1 ? <Button href={link(r.page - 1)}>‹ Previous</Button> : <span className="px-4 text-[var(--muted)]">‹ Previous</span>}
              <span>
                Page {r.page} of {pages}
              </span>
              {r.page < pages ? <Button href={link(r.page + 1)}>Next ›</Button> : <span className="px-4 text-[var(--muted)]">Next ›</span>}
            </nav>
          )}
      <div id="assistant">
            <AgentChat agentId="ping" basePath="/shop" title="Shopping assistant (platform check — the real assistant arrives in P4)" initialMessage={q ? `Help me choose: ${q}` : ''} />
          </div>
        </div>
      </div>
    </main>
  );
}
