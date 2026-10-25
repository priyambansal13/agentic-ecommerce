import { load, send } from '@ac/bff';
import { CategoryApprovalQueueSchema } from '@ac/contracts';
import { fmtDate, fmtInt, KpiGrid, KpiTile, Notice, Panel, Unavailable, Glyph } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DecisionForm, decisionError, flash, readDecision } from '../../lib/decide';
import { requireStaff, StaffFrame } from '../../lib/guard';

export const dynamic = 'force-dynamic';

async function decide(fd: FormData) {
  'use server';
  const d = readDecision(fd);
  if (d.missingNote) redirect(flash('/categories', 'err', 'Add a note explaining the rejection.'));
  const r = await send('POST', `/api/user/v1/category-approvals/${d.id}/decision`, d.body);
  revalidatePath('/categories');
  redirect(r.ok ? flash('/categories', 'ok', d.body.decision === 'APPROVE' ? 'Category approved — the seller can list in it now.' : 'Request rejected.') : flash('/categories', 'err', decisionError(r)));
}

/** Category approvals (category-team, admin): gated-category requests from the user service. */
export default async function CategoryQueue({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const g = await requireStaff('/admin/categories');
  if ('denied' in g) return g.denied;
  const { ok, err } = await searchParams;
  const q = await load(CategoryApprovalQueueSchema, '/api/user/v1/category-approvals/queue');
  return (
    <StaffFrame session={g.session} current="/admin/categories" title="Category approvals" intro="Gated categories need a valid licence or certificate (e.g. FSSAI for grocery). Verify the number with the issuing authority before approving.">
      {ok && <Notice tone="success">{ok}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      {!q.ok ? (
        <Unavailable what="User service" reason={q.error} />
      ) : (
        <>
          <KpiGrid>
            <KpiTile icon={Glyph.clock} label="Waiting for review" value={fmtInt(q.data.items.length)} />
          </KpiGrid>
          {q.data.items.length === 0 && (
            <Panel title="Queue">
              <p className="text-[14px] text-[var(--muted)]">No category requests waiting.</p>
            </Panel>
          )}
          {q.data.items.map((a) => (
            <Panel key={a.approvalId} title={`${a.sellerName} → ${a.category}`} subtitle={`requested ${fmtDate(a.requestedAt)}`}>
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-[var(--muted)]">Requirement</dt>
                <dd>{a.requirement}</dd>
                <dt className="text-[var(--muted)]">Licence no.</dt>
                <dd className="font-mono">{a.licenseNumber}</dd>
              </dl>
              <div className="mt-3">
                <DecisionForm action={decide} id={a.approvalId} version={a.version} noteRequiredHint="Required when rejecting — the seller sees it." />
              </div>
            </Panel>
          ))}
        </>
      )}
    </StaffFrame>
  );
}
