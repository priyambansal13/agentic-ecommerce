const MENU = [
  { href: '/seller', label: 'Home' },
  { href: '/seller/orders', label: 'Orders' },
  { href: '/seller/listings', label: 'Catalog' },
  { href: '/seller/listings/new', label: 'Add a product' },
  { href: '/seller/inventory', label: 'Inventory' },
  { href: '/seller/brands', label: 'Brands' },
  { href: '/seller/categories', label: 'Categories' },
  { href: '/seller/fees', label: 'Fees' },
  { href: '/seller#payments', label: 'Payments' },
  { href: '/seller/account', label: 'Account' },
];

/** Seller Central sub-header (below the global header) — same on every seller page. */
export function SellerNav({ current, name }: { current: string; name?: string }) {
  return (
    <nav aria-label="Seller Central" className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-[var(--line)] bg-[var(--card)] px-4 py-2 text-[14px]">
      <a href="/seller" className="mr-4 font-bold">
        seller <span className="font-normal text-[var(--accent)]">central</span>
      </a>
      {MENU.map((m) => (
        <a key={m.href} href={m.href} aria-current={current === m.href ? 'page' : undefined} className={`rounded px-2 py-1 text-[var(--fg)] hover:bg-[var(--surface-2)] ${current === m.href ? 'font-bold underline decoration-[var(--accent)] decoration-2 underline-offset-4' : ''}`}>
          {m.label}
        </a>
      ))}
      {name && <span className="ml-auto pl-4 text-[12px] text-[var(--muted)]">{name} · India marketplace · INR</span>}
    </nav>
  );
}

/** Page body under the Seller Central nav. */
export function SellerPage({ title, intro, crumbs, children }: { title: string; intro?: React.ReactNode; crumbs?: { href?: string; label: string }[]; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[1200px] space-y-4 px-4 py-4">
      <header>
        {crumbs && (
          <p className="text-[12px] text-[var(--muted)]">
            {crumbs.map((c, i) => (
              <span key={c.label}>
                {i > 0 && ' › '}
                {c.href ? (
                  <a className="text-[var(--link)] hover:underline" href={c.href}>
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
              </span>
            ))}
          </p>
        )}
        <h1 className="text-[28px] leading-tight">{title}</h1>
        {intro && <div className="text-[14px] text-[var(--muted)]">{intro}</div>}
      </header>
      {children}
    </main>
  );
}
