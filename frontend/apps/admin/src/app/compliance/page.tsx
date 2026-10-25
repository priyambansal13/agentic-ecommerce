import { load, send } from '@ac/bff';
import { KycQueueSchema } from '@ac/contracts';
import { CheckList, fmtDate, fmtInt, KpiGrid, KpiTile, Notice, Panel, StatusBadge, Unavailable, Glyph } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DecisionForm, decisionError, flash, readDecision } from '../../lib/decide';
import { requireStaff, StaffFrame } from '../../lib/guard';

export const dynamic = 'force-dynamic';

async function decide(fd: FormData) {
  'use server';
  const d = readDecision(fd);
  if (d.missingNote) redirect(flash('/compliance', 'err', 'Add a note so the seller knows what to fix.'));
  const r = await send('POST', `/api/user/v1/kyc/${d.id}/decision`, d.body);
  revalidatePath('/compliance');
  const done = d.body.decision === 'APPROVE' ? 'Seller verified — the seller role is granted on their next sign-in.' : d.body.decision === 'REJECT' ? 'Application rejected.' : 'Changes requested from the seller.';
  redirect(r.ok ? flash('/compliance', 'ok', done) : flash('/compliance', 'err', decisionError(r)));
}

/** Seller verification (compliance, admin): KYC queue from the user service — GST/PAN/bank checks + decision. */
export default async function Compliance({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const g = await requireStaff('/admin/compliance');
  if ('denied' in g) return g.denied;
  const { ok, err } = await searchParams;
  const q = await load(KycQueueSchema, '/api/user/v1/kyc/queue');
  return (
    <StaffFrame session={g.session} current="/admin/compliance" title="Seller verification" intro="Verify a business before it can sell: GSTIN and PAN must match, the bank account must belong to the business. Automated checks help; you decide.">
      {ok && <Notice tone="success">{ok}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      {!q.ok ? (
        <Unavailable what="User service" reason={q.error} />
      ) : (
        <>
          <KpiGrid>
            <KpiTile icon={Glyph.clock} label="Waiting for review" value={fmtInt(q.data.kpis.submitted)} />
            <KpiTile icon={Glyph.users} label="Waiting on seller" value={fmtInt(q.data.kpis.actionRequired)} hint="changes requested" />
            <KpiTile icon={Glyph.check} label="Verified (30 days)" value={fmtInt(q.data.kpis.verified30d)} />
            <KpiTile icon={Glyph.alert} label="Rejected (30 days)" value={fmtInt(q.data.kpis.rejected30d)} />
          </KpiGrid>
          {q.data.items.length === 0 ? (
            <Panel title="Queue">
              <p className="text-[14px] text-[var(--muted)]">No applications waiting. 🎉</p>
            </Panel>
          ) : (
            q.data.items.map((a) => {
              const failed = a.checks.filter((c) => !c.passed).length;
              return (
                <Panel key={a.sellerId} title={a.displayName} subtitle={`${a.legalName} · ${a.businessType.toLowerCase().replace('_', ' ')} · submitted ${a.submittedAt ? fmtDate(a.submittedAt) : '—'}`}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-[13px]">
                      <dt className="text-[var(--muted)]">GSTIN</dt>
                      <dd className="font-mono">{a.gstin}</dd>
                      <dt className="text-[var(--muted)]">PAN</dt>
                      <dd className="font-mono">{a.panMasked}</dd>
                      <dt className="text-[var(--muted)]">Address</dt>
                      <dd>
                        {a.address.line1}, {a.address.city}, {a.address.state} {a.address.pincode}
                      </dd>
                      <dt className="text-[var(--muted)]">Contact</dt>
                      <dd className="break-all">{a.contactEmail}</dd>
                      <dt className="text-[var(--muted)]">Bank</dt>
                      <dd>
                        {a.bank.accountHolder} · {a.bank.ifsc} · ••••{a.bank.accountLast4}
                      </dd>
                    </dl>
                    <div>
                      <p className="mb-1 flex items-center gap-2 text-[13px] font-bold">
                        Automated checks <StatusBadge tone={failed ? 'warning' : 'good'}>{failed ? `${failed} failed` : 'all passed'}</StatusBadge>
                      </p>
                      <CheckList checks={a.checks} />
                    </div>
                  </div>
                  <div className="mt-3">
                    {a.kycStatus === 'SUBMITTED' ? (
                      <DecisionForm action={decide} id={a.sellerId} version={a.version} changes />
                    ) : (
                      <p className="border-t border-[var(--line)] pt-3 text-[13px]">
                        <StatusBadge tone="warning">Waiting on seller</StatusBadge> Changes requested{a.decisionNote ? `: “${a.decisionNote}”` : ''} — it returns to this queue when the seller resubmits.
                      </p>
                    )}
                  </div>
                </Panel>
              );
            })
          )}
        </>
      )}
    </StaffFrame>
  );
}
