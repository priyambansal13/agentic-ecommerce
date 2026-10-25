import { load, loadPublic, send, type Session } from '@ac/bff';
import { FeeScheduleSchema, FeeSchedulesSchema, FeeScheduleUpdateSchema, type FeeSchedule } from '@ac/contracts';
import { DataTable, Field, fmtDate, fmtMoney, Input, Notice, Panel, StatusBadge, SubmitButton, Textarea, type Tone, Unavailable } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { flash } from '../../lib/decide';
import { requireStaff, StaffFrame } from '../../lib/guard';

export const dynamic = 'force-dynamic';
const TONE: Record<string, Tone> = { DRAFT: 'neutral', PENDING_APPROVAL: 'warning', ACTIVE: 'good', RETIRED: 'neutral', REJECTED: 'critical' };
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const rupees = (minor: number) => String(minor / 100);
const toBps = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? '').trim()) * 100);
const toMinor = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? '').trim()) * 100);
const isMine = (s: Session, who: string | null) => !!who && [s.sub, s.name, s.email].filter(Boolean).includes(who);

function bands(b: FeeSchedule['rules'][number]['closingFees'], cur = 'INR') {
  let prev = 0;
  return b
    .map((x) => {
      const t = x.upToMinor === null ? `>${fmtMoney(prev, cur)}` : `≤${fmtMoney(x.upToMinor, cur)}`;
      if (x.upToMinor !== null) prev = x.upToMinor;
      return `${t}: ${fmtMoney(x.feeMinor, cur)}`;
    })
    .join(' · ');
}

// ---------------------------------------------------------------- server actions (payment service)
async function createDraft() {
  'use server';
  const r = await send('POST', '/api/payment/v1/fees/schedules', {});
  revalidatePath('/fees');
  redirect(r.ok ? flash('/fees', 'ok', 'Draft created from the active schedule. Edit it below, then submit for approval.') : flash('/fees', 'err', r.error));
}

async function saveDraft(fd: FormData) {
  'use server';
  const id = String(fd.get('id'));
  const n = Number(fd.get('ruleCount'));
  const rules = Array.from({ length: n }, (_, i) => {
    const closingFees: { upToMinor: number | null; feeMinor: number }[] = [];
    for (let j = 0; j < 6; j++) {
      const fee = String(fd.get(`r${i}.b${j}.fee`) ?? '').trim();
      if (!fee) continue;
      const upTo = String(fd.get(`r${i}.b${j}.upTo`) ?? '').trim();
      closingFees.push({ upToMinor: upTo ? toMinor(upTo) : null, feeMinor: toMinor(fee) });
    }
    closingFees.sort((a, b) => (a.upToMinor ?? Infinity) - (b.upToMinor ?? Infinity));
    return { category: String(fd.get(`r${i}.category`)), referralBps: toBps(fd.get(`r${i}.referral`)), minReferralMinor: toMinor(fd.get(`r${i}.min`) || '0'), closingFees };
  });
  const body = FeeScheduleUpdateSchema.safeParse({ paymentFeeBps: toBps(fd.get('payment')), gstBps: toBps(fd.get('gst')), rules, note: String(fd.get('note') ?? '').trim() || undefined, rowVersion: Number(fd.get('rowVersion')) });
  if (!body.success) redirect(flash('/fees', 'err', `Check the values: ${body.error.issues[0]?.path.join('.')} — ${body.error.issues[0]?.message}`));
  const r = await send('PUT', `/api/payment/v1/fees/schedules/${id}`, body.data);
  revalidatePath('/fees');
  redirect(r.ok ? flash('/fees', 'ok', 'Draft saved.') : flash('/fees', 'err', r.status === 409 ? 'The draft changed since you opened it — reload and try again.' : r.error));
}

async function transition(fd: FormData) {
  'use server';
  const id = String(fd.get('id'));
  const op = String(fd.get('op')) as 'submit' | 'approve' | 'reject';
  const note = String(fd.get('note') ?? '').trim();
  if (op === 'reject' && !note) redirect(flash('/fees', 'err', 'Add a note explaining the rejection.'));
  const r = await send('POST', `/api/payment/v1/fees/schedules/${id}/${op}`, { rowVersion: Number(fd.get('rowVersion')), ...(note ? { note } : {}) });
  revalidatePath('/fees');
  const ok = { submit: 'Submitted for approval. A second person (finance or admin) must approve it.', approve: 'Schedule approved — it applies to orders placed from its effective date.', reject: 'Schedule rejected and returned to finance.' }[op];
  if (r.ok) redirect(flash('/fees', 'ok', ok));
  const err = r.status === 403 ? (r.error || 'Maker-checker: you cannot approve a schedule you created or submitted — ask another finance or admin user.') : r.status === 409 ? 'The schedule changed since you opened it — reload.' : r.error;
  redirect(flash('/fees', 'err', err));
}

// ---------------------------------------------------------------- page
function RateCard({ s, base }: { s: FeeSchedule; base?: FeeSchedule }) {
  const prev = (cat: string) => base?.rules.find((r) => r.category === cat);
  const delta = (now: string, was?: string) => (was !== undefined && was !== now ? <span className="text-[12px]"> (was {was})</span> : null);
  return (
    <>
      <DataTable
        caption={`Fee schedule v${s.version}`}
        rows={s.rules}
        columns={[
          { key: 'c', label: 'Category', render: (r) => <b>{r.category}</b> },
          { key: 'r', label: 'Referral', align: 'right', render: (r) => <span className={prev(r.category) && prev(r.category)!.referralBps !== r.referralBps ? 'font-bold' : ''}>{pct(r.referralBps)}{base && delta(pct(r.referralBps), prev(r.category) ? pct(prev(r.category)!.referralBps) : undefined)}</span> },
          { key: 'm', label: 'Min. referral', align: 'right', render: (r) => fmtMoney(r.minReferralMinor) },
          { key: 'b', label: 'Closing fee bands', render: (r) => <span className="text-[12px]">{bands(r.closingFees)}{base && prev(r.category) && bands(prev(r.category)!.closingFees) !== bands(r.closingFees) ? <b> (changed)</b> : null}</span> },
        ]}
      />
      <p className="mt-2 text-[13px]">
        Payment-collection fee <b>{pct(s.paymentFeeBps)}</b>
        {base && delta(pct(s.paymentFeeBps), pct(base.paymentFeeBps))} · GST on fees <b>{pct(s.gstBps)}</b>
        {base && delta(pct(s.gstBps), pct(base.gstBps))}
      </p>
    </>
  );
}

function DraftEditor({ s }: { s: FeeSchedule }) {
  return (
    <form action={saveDraft} className="space-y-3">
      <input type="hidden" name="id" value={s.scheduleId} />
      <input type="hidden" name="rowVersion" value={s.rowVersion} />
      <input type="hidden" name="ruleCount" value={s.rules.length} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Payment-collection fee (%)">
          <Input name="payment" inputMode="decimal" defaultValue={s.paymentFeeBps / 100} />
        </Field>
        <Field label="GST on fees (%)">
          <Input name="gst" inputMode="decimal" defaultValue={s.gstBps / 100} />
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Referral and closing fees per category</caption>
          <thead>
            <tr className="border-b border-[var(--line)] text-left">
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2">Referral %</th>
              <th className="py-1 pr-2">Min. referral ₹</th>
              <th className="py-1">Closing fee bands — up to ₹ (blank = above) : fee ₹</th>
            </tr>
          </thead>
          <tbody>
            {s.rules.map((r, i) => (
              <tr key={r.category} className="border-b border-[var(--line)] align-top">
                <td className="py-2 pr-2 font-bold">
                  {r.category}
                  <input type="hidden" name={`r${i}.category`} value={r.category} />
                </td>
                <td className="py-2 pr-2">
                  <Input name={`r${i}.referral`} inputMode="decimal" defaultValue={r.referralBps / 100} className="w-20" aria-label={`${r.category} referral percent`} />
                </td>
                <td className="py-2 pr-2">
                  <Input name={`r${i}.min`} inputMode="decimal" defaultValue={rupees(r.minReferralMinor)} className="w-20" aria-label={`${r.category} minimum referral`} />
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {[...r.closingFees, { upToMinor: null, feeMinor: -1 }].slice(0, 6).map((b, j) => (
                      <span key={j} className="flex items-center gap-1">
                        <Input name={`r${i}.b${j}.upTo`} inputMode="decimal" defaultValue={b.feeMinor < 0 || b.upToMinor === null ? '' : rupees(b.upToMinor)} placeholder="above" className="w-20" aria-label={`${r.category} band ${j + 1} up to`} />
                        <span aria-hidden>:</span>
                        <Input name={`r${i}.b${j}.fee`} inputMode="decimal" defaultValue={b.feeMinor < 0 ? '' : rupees(b.feeMinor)} placeholder="fee" className="w-16" aria-label={`${r.category} band ${j + 1} fee`} />
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Change note" hint="Why the change — shown to the approver and kept in the history">
        <Textarea name="note" rows={2} maxLength={500} defaultValue={s.note ?? ''} />
      </Field>
      <SubmitButton variant="outline">Save draft</SubmitButton>
    </form>
  );
}

function Transition({ s, op, label, variant = 'primary', note = false }: { s: FeeSchedule; op: 'submit' | 'approve' | 'reject'; label: string; variant?: 'primary' | 'danger' | 'secondary'; note?: boolean }) {
  return (
    <form action={transition} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={s.scheduleId} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="rowVersion" value={s.rowVersion} />
      {note && (
        <Field label="Reason" className="min-w-[16rem]">
          <Input name="note" maxLength={500} />
        </Field>
      )}
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </form>
  );
}

/** Fee schedule (finance, admin) — payment service. Versioned, effective-dated, maker-checker approval. */
export default async function FeesAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const g = await requireStaff('/admin/fees');
  if ('denied' in g) return g.denied;
  const { ok, err } = await searchParams;
  const [active, all] = await Promise.all([loadPublic(FeeScheduleSchema, '/api/payment/v1/fees/schedule'), load(FeeSchedulesSchema, '/api/payment/v1/fees/schedules')]);
  const items = all.ok ? [...all.data.items].sort((a, b) => b.version - a.version) : [];
  const draft = items.find((s) => s.status === 'DRAFT');
  const pending = items.find((s) => s.status === 'PENDING_APPROVAL');
  const base = active.ok ? active.data : undefined;
  const me = g.session;
  return (
    <StaffFrame session={me} current="/admin/fees" title="Fee schedule" intro="Referral % by category, closing fee by price band, payment-collection fee and GST on fees. Finance drafts and submits a new version; a different finance or admin user approves it (maker-checker). Orders keep the fees in force when they were placed.">
      {ok && <Notice tone="success">{ok}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}

      <Panel title={active.ok ? `Active schedule · v${active.data.version}` : 'Active schedule'} subtitle={active.ok && active.data.effectiveFrom ? `effective ${fmtDate(active.data.effectiveFrom)} · approved by ${active.data.approvedBy ?? '—'}` : undefined}>
        {active.ok ? <RateCard s={active.data} /> : <Unavailable what="Payment service" reason={active.error} />}
      </Panel>

      {pending && (
        <Panel title={`Waiting for approval · v${pending.version}`} subtitle={`created by ${pending.createdBy} · submitted by ${pending.submittedBy ?? '—'}`}>
          {pending.note && (
            <p className="mb-2 text-[13px]">
              <b>Change note:</b> {pending.note}
            </p>
          )}
          <RateCard s={pending} base={base} />
          <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-[var(--line)] pt-3">
            {isMine(me, pending.createdBy) || isMine(me, pending.submittedBy) ? (
              <Notice tone="info" title="Needs a second person">
                You created or submitted this version, so someone else in finance or an admin must approve it.
              </Notice>
            ) : (
              <>
                <Transition s={pending} op="approve" label="Approve and activate" />
                <Transition s={pending} op="reject" label="Reject" variant="danger" note />
              </>
            )}
          </div>
        </Panel>
      )}

      {draft ? (
        <Panel title={`Draft · v${draft.version}`} subtitle={`created by ${draft.createdBy} ${fmtDate(draft.createdAt)}`}>
          <DraftEditor s={draft} />
          <div className="mt-3 border-t border-[var(--line)] pt-3">
            <Transition s={draft} op="submit" label="Submit for approval" variant="secondary" />
          </div>
        </Panel>
      ) : (
        !pending &&
        all.ok && (
          <Panel title="Change the fees">
            <form action={createDraft} className="flex flex-wrap items-center gap-3">
              <SubmitButton>Create draft from active schedule</SubmitButton>
              <span className="text-[12px] text-[var(--muted)]">Nothing changes for sellers until a second person approves the new version.</span>
            </form>
          </Panel>
        )
      )}

      <Panel title="Version history">
        {all.ok ? (
          <DataTable
            caption="Fee schedule versions"
            rows={items}
            columns={[
              { key: 'v', label: 'Version', render: (s) => `v${s.version}` },
              { key: 's', label: 'Status', render: (s) => <StatusBadge tone={TONE[s.status] ?? 'neutral'}>{s.status.toLowerCase().replace('_', ' ')}</StatusBadge> },
              { key: 'e', label: 'Effective from', render: (s) => (s.effectiveFrom ? fmtDate(s.effectiveFrom) : '—') },
              { key: 'c', label: 'Created by', render: (s) => s.createdBy },
              { key: 'sb', label: 'Submitted by', render: (s) => s.submittedBy ?? '—' },
              { key: 'a', label: 'Approved by', render: (s) => s.approvedBy ?? '—' },
              { key: 'n', label: 'Note', render: (s) => <span className="text-[12px]">{s.note ?? '—'}</span> },
            ]}
          />
        ) : (
          <Unavailable what="Fee schedule history" reason={all.error} />
        )}
      </Panel>
    </StaffFrame>
  );
}
