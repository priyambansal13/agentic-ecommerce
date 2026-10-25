import { load } from '@ac/bff';
import { BuyerReturnsDashboardSchema, MyReturnsSchema } from '@ac/contracts';
import { Breadcrumb, Button, EmptyState, fmtMoney, Forbidden, Icons, StatusBadge, Unavailable } from '@ac/ui';
import { requireBuyer } from '../../lib/session';
import { statusOf } from '../../lib/returns';

export const dynamic = 'force-dynamic';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type Row = { id: string; orderNo: string; status: string; text: string; requestedMinor: number; approvedMinor: number | null; openedAt: string | null };

/** Returns & refunds: the buyer's returns (returns service). Falls back to the returns dashboard read model. */
export default async function MyReturns() {
  const { session, ok } = await requireBuyer('/account/returns');
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;
  const mine = await load(MyReturnsSchema, '/api/returns/v1/returns/mine');
  let rows: Row[] = [];
  let currency = 'INR';
  let error: string | null = null;
  if (mine.ok) {
    currency = mine.data.currency;
    rows = mine.data.items.map((r) => ({ id: r.returnId, orderNo: r.orderNo, status: r.status, text: r.statusText, requestedMinor: r.requestedMinor, approvedMinor: r.approvedMinor, openedAt: r.openedAt }));
  } else {
    const dash = await load(BuyerReturnsDashboardSchema, '/api/returns/v1/dashboard/buyer');
    if (dash.ok) {
      currency = dash.data.currency;
      rows = dash.data.cases.map((c) => ({ id: c.caseId, orderNo: c.orderNo, status: c.status, text: statusOf(c.status).text, requestedMinor: c.requestedMinor, approvedMinor: null, openedAt: c.openedAt }));
    } else error = mine.error;
  }
  return (
    <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
      <Breadcrumb items={[{ href: '/account', label: 'Your Account' }, { label: 'Returns & refunds' }]} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-[28px] leading-tight">Returns & refunds</h1>
        <Button href="/account/orders">Start a return from Your Orders</Button>
      </div>
      {error ? (
        <Unavailable what="Your returns" reason={error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Icons.returns} title="No returns yet" text="To return or replace an item, open the order in Your Orders and choose “Return or replace items”." action={<Button href="/account/orders" variant="primary">Go to Your Orders</Button>} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const s = statusOf(r.status);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 text-[14px]">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">Order {r.orderNo}</p>
                  <p className="text-[12px] text-[var(--muted)]">{r.openedAt ? `Requested ${day(r.openedAt)} · ` : ''}requested {fmtMoney(r.requestedMinor, currency)}{r.approvedMinor !== null ? ` · approved ${fmtMoney(r.approvedMinor, currency)}` : ''}</p>
                </div>
                <StatusBadge tone={s.tone}>{r.text || s.text}</StatusBadge>
                <Button href={`/account/returns/${r.id}`}>View return</Button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
