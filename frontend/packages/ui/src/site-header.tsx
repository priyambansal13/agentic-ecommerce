import type { ReactNode } from 'react';
import { ZoneLink } from './zone-link.js';

export interface NavItem {
  href: string;
  label: string;
}
export interface HeaderUser {
  name: string;
  roles: string[];
}

const STAFF = ['admin', 'support', 'finance', 'fraud-analyst', 'moderator', 'compliance', 'brand-team', 'category-team'];
const SEARCH_DEPTS = ['All', 'Electronics', 'Outdoor', 'Home', 'Fashion', 'Grocery', 'Beauty', 'Books', 'Jewellery'];

function Logo() {
  return (
    <span className="flex items-baseline font-bold tracking-tight text-[var(--nav-fg)]" aria-label="agentic commerce home">
      <span className="text-[22px] leading-none">agentic</span>
      <span className="text-[13px] text-[var(--accent)]">.commerce</span>
    </span>
  );
}

function Stack({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[12px] text-[var(--nav-muted)]">{top}</span>
      <span className="text-[14px] font-bold">{bottom}</span>
    </span>
  );
}

/**
 * Global header rendered by every zone (Amazon-style): logo · search · account · orders · cart, then a sub-nav
 * whose links depend on the signed-in user's roles. All cross-zone links are hard navigations (ZoneLink).
 */
export function SiteHeader({ current, user, returnTo = '/', cartCount = 0 }: { current?: string; nav?: NavItem[]; user?: HeaderUser | null; returnTo?: string; cartCount?: number }) {
  const staff = !!user && user.roles.some((r) => STAFF.includes(r));
  const seller = !!user && user.roles.includes('seller');
  const first = user?.name.split(' ')[0];
  const signIn = `/api/auth/login?realm=customers&returnTo=${encodeURIComponent(returnTo)}`;
  const box = 'rounded-sm border border-transparent px-2 py-1 hover:border-[var(--nav-fg)]';
  const sub: NavItem[] = staff
    ? [{ href: '/admin', label: 'Console' }]
    : [
        { href: '/shop', label: 'Shop' },
        { href: '/account/orders', label: 'Your Orders' },
        { href: '/account/orders?tab=buy-again', label: 'Buy Again' },
        { href: '/account/help', label: 'Customer Service' },
        { href: seller ? '/seller' : '/seller/register', label: seller ? 'Seller Central' : 'Sell' },
      ];
  return (
    <header className="text-[var(--nav-fg)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 bg-[var(--nav)] px-3 py-2">
        <ZoneLink href="/" className={box}>
          <Logo />
        </ZoneLink>
        <form action="/shop" method="get" role="search" className="order-last flex h-10 w-full overflow-hidden rounded-md md:order-none md:w-auto md:flex-1">
          <label className="sr-only" htmlFor="ac-dept">
            Search in
          </label>
          <select id="ac-dept" name="dept" className="bg-[#e6e6e6] px-2 text-[12px] text-[#555]">
            {SEARCH_DEPTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="ac-q">
            Search agentic.commerce
          </label>
          <input id="ac-q" name="q" placeholder="Search agentic.commerce" className="min-w-0 flex-1 bg-white px-3 text-[15px] text-[#0f1111] outline-none" />
          <button type="submit" aria-label="Go" className="w-11 bg-[var(--search-btn)] hover:bg-[#f3a847]">
            <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5" aria-hidden fill="none" stroke="#0f1111" strokeWidth="2.4">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" strokeLinecap="round" />
            </svg>
          </button>
        </form>
        <span className="ml-auto flex items-center gap-1 md:ml-0">
          {user ? (
            <ZoneLink href={staff ? '/admin' : '/account'} className={box}>
              <Stack top={`Hello, ${first}`} bottom={staff ? 'Console & Roles ▾' : 'Account & Lists ▾'} />
            </ZoneLink>
          ) : (
            <ZoneLink href={signIn} className={box}>
              <Stack top="Hello, sign in" bottom="Account & Lists ▾" />
            </ZoneLink>
          )}
          {!staff && (
            <ZoneLink href="/account/orders" className={`${box} hidden sm:block`}>
              <Stack top="Returns" bottom="& Orders" />
            </ZoneLink>
          )}
          {!staff && (
            <ZoneLink href="/shop/cart" className={`${box} flex items-end gap-1`} aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
              <span className="relative">
                <svg viewBox="0 0 32 28" className="h-8 w-9" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 3h4l3.5 15h15L28 8H8" strokeLinejoin="round" />
                  <circle cx="12" cy="24" r="2" />
                  <circle cx="23" cy="24" r="2" />
                </svg>
                <span data-testid="cart-count" className="absolute -top-1 left-[13px] min-w-[1ch] text-center text-[15px] font-bold text-[var(--accent)]">{cartCount > 99 ? '99+' : cartCount}</span>
              </span>
              <span className="text-[14px] font-bold">Cart</span>
            </ZoneLink>
          )}
        </span>
      </div>
      <nav aria-label="Site" className="flex items-center gap-1 overflow-x-auto whitespace-nowrap bg-[var(--nav-2)] px-3 py-1 text-[14px]">
        {sub.map((n) => (
          <ZoneLink key={n.href} href={n.href} aria-current={current === n.href ? 'page' : undefined} className="rounded-sm border border-transparent px-2 py-1 hover:border-[var(--nav-fg)]">
            {n.label}
          </ZoneLink>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {user ? (
            <>
              <span className="px-2 text-[12px] text-[var(--nav-muted)]">{user.roles.join(' · ')}</span>
              <ZoneLink href="/api/auth/logout" className="rounded-sm border border-transparent px-2 py-1 hover:border-[var(--nav-fg)]">
                Sign out
              </ZoneLink>
            </>
          ) : (
            <ZoneLink href={`/api/auth/login?realm=staff&returnTo=${encodeURIComponent('/admin')}`} className="rounded-sm border border-transparent px-2 py-1 text-[12px] hover:border-[var(--nav-fg)]">
              Staff sign in
            </ZoneLink>
          )}
        </span>
      </nav>
    </header>
  );
}

export function Page({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-6">
      <h1 className="text-[28px] font-normal leading-tight">{title}</h1>
      {intro && <p className="text-[var(--muted)]">{intro}</p>}
      {children}
    </main>
  );
}
