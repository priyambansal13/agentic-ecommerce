import { productImageUrl } from '@ac/contracts';
import { Breadcrumb, Field, fmtMoney, Forbidden, Notice, ProductImage, StatusBadge, SubmitButton, Textarea, Unavailable } from '@ac/ui';
import { loadReturn, reasonLabel, statusOf, UUID } from '../../../lib/returns';
import { requireBuyer } from '../../../lib/session';
import { appealReturn } from './actions';
import { PhotoUpload } from './photo-upload';

export const dynamic = 'force-dynamic';
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const GOOD = ['AUTO_APPROVED', 'APPROVED', 'REFUND_PENDING', 'REFUNDED'];

/** One return: plain-language status + timeline, what we decided and why, photos, appeal. No internal risk data. */
export default async function ReturnStatus({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; warn?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { session, ok } = await requireBuyer(`/account/returns/${id}`);
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;
  const crumbs = <Breadcrumb items={[{ href: '/account', label: 'Your Account' }, { href: '/account/returns', label: 'Returns & refunds' }, { label: 'Return details' }]} />;
  const r = UUID.test(id) ? await loadReturn(id) : ({ ok: false, status: 404, error: 'not found' } as const);
  if (!r.ok) {
    return (
      <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
        {crumbs}
        {r.status === 404 ? <Notice tone="error" title="Return not found">We couldn’t find this return in your account.</Notice> : <Unavailable what="Your return" reason={r.error} />}
      </main>
    );
  }
  const x = r.data;
  const st = statusOf(x.status);
  return (
    <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
      {crumbs}
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.warn && <Notice tone="warning">{sp.warn}</Notice>}
      {sp.err && <Notice tone="error">{sp.err}</Notice>}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-[28px] leading-tight">Return for order <span className="whitespace-nowrap">{x.orderNo}</span></h1>
          <p className="text-[14px] text-[var(--muted)]">
            Requested {when(x.openedAt)} · {reasonLabel(x.reasonCode)}
          </p>
        </div>
        <StatusBadge tone={st.tone}>{x.statusText || st.text}</StatusBadge>
      </header>

      <section className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <div className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
            <h2 className="text-[18px] font-bold">{x.statusText || st.text}</h2>
            {x.explanation ? <p className="text-[14px]">{x.explanation}</p> : <p className="text-[14px] text-[var(--muted)]">We’re reviewing your request. Most returns are decided within minutes; some need a person and take up to 2 business days.</p>}
            {x.approvedMinor !== null && GOOD.includes(x.status) && (
              <p className="text-[14px]">
                Approved amount: <strong>{fmtMoney(x.approvedMinor, x.currency)}</strong>
                {x.resolution === 'REPLACEMENT' ? ' (replacement)' : x.resolution === 'STORE_CREDIT' ? ' (store credit)' : ' — refunded to your original payment method'}
              </p>
            )}
            {x.status === 'AWAITING_BUYER' && <Notice tone="warning" title="We need a photo">Add a clear photo of the item (and any damage) so we can continue.</Notice>}
            {x.canAddPhoto && <PhotoUpload returnId={x.returnId} />}
          </div>

          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
            <h2 className="mb-2 text-[18px] font-bold">Items</h2>
            <ul className="divide-y divide-[var(--line)]">
              {x.lines.map((l) => (
                <li key={l.productId} className="flex items-center gap-3 py-2 text-[14px]">
                  <span className="rounded-md border border-[var(--line)] bg-white p-1">
                    <ProductImage src={productImageUrl(l.productId, 'thumb')} category="" title={l.title} box={56} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <a href={`/shop/p/${l.productId}`} className="font-bold text-[var(--link)] hover:underline">
                      {l.title}
                    </a>
                    <span className="block text-[12px] text-[var(--muted)]">
                      Qty {l.qty} · {fmtMoney(l.unitPriceMinor, x.currency)} each
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-right text-[14px]">
              Requested: <strong>{fmtMoney(x.requestedMinor, x.currency)}</strong>
            </p>
          </div>

          {x.evidence.some((e) => e.kind === 'PHOTO' && e.hasImage) && (
            <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
              <h2 className="mb-2 text-[18px] font-bold">Your photos</h2>
              <div className="flex flex-wrap gap-3">
                {x.evidence
                  .filter((e) => e.kind === 'PHOTO' && e.hasImage)
                  .map((e) => (
                    <a key={e.evidenceId} href={`/account/api/evidence/${e.evidenceId}/image`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private evidence photo via the zone proxy */}
                      <img src={`/account/api/evidence/${e.evidenceId}/image`} alt={`Photo added ${when(e.at)}`} width={120} height={120} loading="lazy" className="h-[120px] w-[120px] rounded-md border border-[var(--line)] object-cover" />
                    </a>
                  ))}
              </div>
            </div>
          )}

          {x.canAppeal && (
            <form action={appealReturn} className="space-y-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
              <h2 className="text-[18px] font-bold">Disagree with this decision?</h2>
              <input type="hidden" name="returnId" value={x.returnId} />
              <Field label="Tell us why" hint="A member of our team — not an automated system — reviews every appeal.">
                <Textarea name="note" rows={3} minLength={10} maxLength={1000} required />
              </Field>
              <SubmitButton>Send appeal</SubmitButton>
            </form>
          )}
        </div>

        <aside className="h-fit rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="mb-2 text-[16px] font-bold">Progress</h2>
          <ol className="space-y-3">
            {x.timeline.map((t, i) => {
              const s = statusOf(t.status);
              const last = i === x.timeline.length - 1;
              return (
                <li key={`${t.status}-${i}`} className="flex gap-2 text-[13px]">
                  <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.tone === 'critical' ? 'bg-[var(--danger)] text-white' : s.tone === 'good' ? 'bg-[var(--success)] text-white' : last ? 'bg-[var(--accent)] text-[#0f1111]' : 'bg-[var(--surface-2)] text-[var(--muted)]'}`}>
                    {s.tone === 'critical' ? '✕' : s.tone === 'good' ? '✓' : last ? '•' : '✓'}
                  </span>
                  <span>
                    <span className={last ? 'font-bold' : ''}>{t.text}</span>
                    <span className="block text-[12px] text-[var(--muted)]">{when(t.at)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 border-t border-[var(--line)] pt-2 text-[13px]">
            <a className="text-[var(--link)] hover:underline" href={`/account/orders/${x.orderId}`}>
              View order {x.orderNo}
            </a>
          </p>
        </aside>
      </section>
    </main>
  );
}
