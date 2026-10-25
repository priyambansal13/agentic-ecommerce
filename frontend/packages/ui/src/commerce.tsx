import type { AnchorHTMLAttributes, ReactNode } from 'react';

/** Amazon-style building blocks (server components). Links/buttons are plain anchors: callers pass in-zone or
 *  cross-zone hrefs and decide; nothing here does client-side routing. */

type BtnVariant = 'primary' | 'secondary' | 'outline';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-[var(--btn)] border-[var(--btn-border)] text-[#0f1111] hover:brightness-95',
  secondary: 'bg-[var(--btn-2)] border-[var(--btn-2-border)] text-[#0f1111] hover:brightness-95',
  outline: 'bg-[var(--card)] border-[var(--line)] text-[var(--fg)] hover:bg-[var(--surface-2)]',
};
/** Pill button rendered as a link. */
export function Button({ variant = 'outline', className = '', ...a }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: BtnVariant }) {
  return <a {...a} className={`inline-flex items-center justify-center rounded-full border px-4 py-1.5 text-[13px] shadow-[0_2px_5px_rgba(213,217,217,.5)] dark:shadow-none ${BTN[variant]} ${className}`} />;
}

export function TextLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} className={`text-[var(--link)] hover:text-[var(--link-hover)] hover:underline ${props.className ?? ''}`} />;
}

export function Breadcrumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[12px]">
      {items.map((i, k) => (
        <span key={i.label}>
          {k > 0 && <span className="px-1 text-[var(--muted)]">›</span>}
          {i.href ? <TextLink href={i.href}>{i.label}</TextLink> : <span className="text-[#c45500]">{i.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Tabs as links (?tab=…): the active tab is bold with an orange underline. */
export function Tabs({ tabs, active }: { tabs: { id: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Tabs" className="flex gap-6 overflow-x-auto border-b border-[var(--line)] text-[14px]">
      {tabs.map((t) => (
        <a key={t.id} href={t.href} aria-current={t.id === active ? 'page' : undefined} className={`-mb-px whitespace-nowrap border-b-2 pb-2 ${t.id === active ? 'border-[var(--accent)] font-bold' : 'border-transparent text-[var(--link)] hover:text-[var(--link-hover)]'}`}>
          {t.label}
          {t.count !== undefined && <span className="ml-1 text-[var(--muted)]">({t.count})</span>}
        </a>
      ))}
    </nav>
  );
}

/** Seller-Central-like "Global Snapshot": a strip of compact metric cells. */
export function SnapshotStrip({ children }: { children: ReactNode }) {
  return <section aria-label="Global snapshot" className="grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-[var(--line)] [&>*]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r">{children}</section>;
}
export function SnapshotItem({ title, value, sub, href, status }: { title: string; value: ReactNode; sub?: ReactNode; href?: string; status?: ReactNode }) {
  const body = (
    <>
      <p className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted)]">{title}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums">{value}</p>
      {status && <div className="mt-1">{status}</div>}
      {sub && <p className="mt-1 text-[12px] text-[var(--muted)]">{sub}</p>}
    </>
  );
  return href ? (
    <a href={href} className="block p-3 hover:bg-[var(--surface-2)]">
      {body}
    </a>
  ) : (
    <div className="p-3">{body}</div>
  );
}

/** "Your Account"-style tile: icon, title, one-line description. */
export function AccountTile({ href, title, desc, icon }: { href: string; title: string; desc: string; icon: ReactNode }) {
  return (
    <a href={href} className="flex gap-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 hover:bg-[var(--surface-2)]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center text-[var(--muted)]" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-[17px]">{title}</span>
        <span className="block text-[14px] text-[var(--muted)]">{desc}</span>
      </span>
    </a>
  );
}

const THUMB: Record<string, { bg: string; fg: string; d: string }> = {
  _: { bg: '#eef0f2', fg: '#565959', d: 'M8 14 L20 8 L32 14 V27 L20 33 L8 27 Z M8 14 L20 20 L32 14 M20 20 V33' },
  outdoor: { bg: '#e6f2ea', fg: '#1f6f43', d: 'M4 30 L16 12 L22 20 L26 15 L36 30 Z M26 9 a3 3 0 1 0 0.1 0' },
  electronics: { bg: '#e7eefb', fg: '#1c5cab', d: 'M10 22 v-4 a10 10 0 0 1 20 0 v4 M8 21 h5 v9 h-5 z M27 21 h5 v9 h-5 z' },
  home: { bg: '#fbefe3', fg: '#a35212', d: 'M8 20 L20 9 L32 20 M12 18 v13 h16 v-13 M18 31 v-7 h4 v7' },
  fashion: { bg: '#f6e9f1', fg: '#9b2d68', d: 'M14 9 l-7 5 3 5 3-2 v14 h14 v-14 l3 2 3-5 -7-5 c-1 3-3 4-6 4 s-5-1-6-4 z' },
  grocery: { bg: '#f3f1dc', fg: '#6b6312', d: 'M8 15 h24 l-3 15 h-18 z M14 15 l4-7 M26 15 l-4-7' },
  beauty: { bg: '#fbe9ec', fg: '#a3324b', d: 'M17 14 h6 v17 h-6 z M18 14 v-5 h4 v5 M15 31 h10' },
  books: { bg: '#ece9f6', fg: '#4b3a91', d: 'M8 10 h10 a3 3 0 0 1 2 1 a3 3 0 0 1 2 -1 h10 v20 h-10 a3 3 0 0 0 -2 1 a3 3 0 0 0 -2 -1 h-10 z M20 11 v20' },
  jewellery: { bg: '#f7f0dc', fg: '#8a6410', d: 'M12 16 l4-6 h8 l4 6 -8 14 z M12 16 h16 M17 10 l3 6 3-6' },
};
/** Generated product thumbnail (the demo catalogue has no images): category glyph on a tinted tile. */
export function ProductThumb({ category, title, size = 90 }: { category: string; title: string; size?: number }) {
  const t = THUMB[category] ?? THUMB._;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={title} className="shrink-0 rounded-md">
      <rect width="40" height="40" rx="4" fill={t.bg} />
      <path d={t.d} fill="none" stroke={t.fg} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Simple outline icons for account tiles. */
export const Icons = {
  box: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 15 24 6l18 9v18L24 42 6 33z M6 15l18 9 18-9 M24 24v18" strokeLinejoin="round" />
    </svg>
  ),
  returns: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 18H34a8 8 0 0 1 0 16H18 M20 11l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="11" y="21" width="26" height="19" rx="3" />
      <path d="M16 21v-6a8 8 0 0 1 16 0v6" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 10h32v22H22l-8 7v-7H8z" strokeLinejoin="round" />
      <path d="M20 18a4 4 0 1 1 5 4c-1 .5-1 1.5-1 2.5 M24 28v.5" strokeLinecap="round" />
    </svg>
  ),
  store: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 18 11 8h26l3 10 M8 18a5 5 0 0 0 10 0 5 5 0 0 0 10 0 5 5 0 0 0 10 0 M11 22v18h26V22 M20 40V30h8v10" strokeLinejoin="round" />
    </svg>
  ),
  again: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M38 24a14 14 0 1 1-4-10 M38 8v8h-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
