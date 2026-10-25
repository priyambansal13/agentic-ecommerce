import { getSession, hasRole, loginUrl, type Session } from '@ac/bff';
import { DashboardNav, Forbidden, Glyph } from '@ac/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

/** Staff dashboards in this zone and who may open them (the owning services enforce the same roles). */
export const STAFF_DASHBOARDS = [
  { href: '/admin', path: '/', icon: Glyph.chart, label: 'Overview', roles: ['admin'] },
  { href: '/admin/support', path: '/support', icon: Glyph.refund, label: 'Support', roles: ['support', 'admin'] },
  { href: '/admin/finance', path: '/finance', icon: Glyph.money, label: 'Finance', roles: ['finance', 'admin'] },
  { href: '/admin/fraud', path: '/fraud', icon: Glyph.alert, label: 'Fraud', roles: ['fraud-analyst', 'admin'] },
  { href: '/admin/moderation', path: '/moderation', icon: Glyph.gavel, label: 'Moderation', roles: ['moderator', 'admin'] },
  { href: '/admin/compliance', path: '/compliance', icon: Glyph.shield, label: 'Seller verification', roles: ['compliance', 'admin'] },
  { href: '/admin/brands', path: '/brands', icon: Glyph.star, label: 'Brand Registry', roles: ['brand-team', 'admin'] },
  { href: '/admin/categories', path: '/categories', icon: Glyph.check, label: 'Category approvals', roles: ['category-team', 'admin'] },
  { href: '/admin/fees', path: '/fees', icon: Glyph.percent, label: 'Fee schedule', roles: ['finance', 'admin'] },
  { href: '/admin/agents', path: '/agents', icon: Glyph.bot, label: 'Agents', roles: ['admin'] },
];

/** Signed-in staff user with one of `roles`, or redirect to staff login / render 403. */
export async function requireStaff(href: string): Promise<{ session: Session } | { denied: ReactNode }> {
  const d = STAFF_DASHBOARDS.find((x) => x.href === href)!;
  const session = await getSession();
  if (!session || session.realm !== 'staff') redirect(loginUrl('staff', href));
  if (!hasRole(session, ...d.roles)) {
    const first = STAFF_DASHBOARDS.find((x) => hasRole(session, ...x.roles));
    if (href === '/admin' && first) redirect(first.path);
    return { denied: <Forbidden need={d.roles.join(' or ')} signedInAs={session.name} /> };
  }
  return { session };
}

/** Page frame: role-filtered dashboard navigation + content. */
export function StaffFrame({ session, current, title, intro, children }: { session: Session; current: string; title: string; intro?: string; children: ReactNode }) {
  const icon = STAFF_DASHBOARDS.find((x) => x.href === current)?.icon;
  const items = STAFF_DASHBOARDS.filter((x) => hasRole(session, ...x.roles)).map(({ href, label, icon }) => ({ href, label, icon }));
  return (
    <main className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 md:grid-cols-[12rem_1fr]">
      <DashboardNav items={items} current={current} />
      <div className="min-w-0 space-y-4">
        <header className="flex items-start gap-3">
          {icon && (
            <span aria-hidden className="mt-1 hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--muted)] shadow-[0_1px_2px_rgba(15,17,17,0.12)] sm:flex [&>svg]:h-6 [&>svg]:w-6">
              {icon}
            </span>
          )}
          <div>
            <p className="text-[12px] text-[var(--muted)]">Console › {title}</p>
            <h1 className="text-[28px] leading-tight">{title}</h1>
            {intro && <p className="max-w-3xl text-[var(--muted)]">{intro}</p>}
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

/** Pages shared by several dashboards (e.g. a refund case for support AND finance): any of `roles`. */
export async function requireRoles(returnTo: string, roles: string[]): Promise<{ session: Session } | { denied: ReactNode }> {
  const session = await getSession();
  if (!session || session.realm !== 'staff') redirect(loginUrl('staff', returnTo));
  if (!hasRole(session, ...roles)) return { denied: <Forbidden need={roles.join(' or ')} signedInAs={session.name} /> };
  return { session };
}
