import { load, send } from '@ac/bff';
import { BrandQueueSchema } from '@ac/contracts';
import { CheckList, fmtDate, fmtInt, KpiGrid, KpiTile, Notice, Panel, StatusBadge, TextLink, Unavailable, Glyph } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DecisionForm, decisionError, flash, readDecision } from '../../lib/decide';
import { requireStaff, StaffFrame } from '../../lib/guard';

export const dynamic = 'force-dynamic';
const REL: Record<string, string> = { OWNER: 'brand owner', MANUFACTURER: 'manufacturer', AUTHORIZED_AGENT: 'authorised agent' };

async function decide(fd: FormData) {
  'use server';
  const d = readDecision(fd);
  if (d.missingNote) redirect(flash('/brands', 'err', 'Add a note explaining the rejection.'));
  const r = await send('POST', `/api/catalog/v1/brand-applications/${d.id}/decision`, d.body);
  revalidatePath('/brands');
  redirect(r.ok ? flash('/brands', 'ok', d.body.decision === 'APPROVE' ? 'Brand registered — the owner now controls its product pages.' : 'Application rejected.') : flash('/brands', 'err', decisionError(r)));
}

/** Brand Registry (brand-team, admin): trademark-backed brand applications from the catalog service. */
export default async function BrandsQueue({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const g = await requireStaff('/admin/brands');
  if ('denied' in g) return g.denied;
  const { ok, err } = await searchParams;
  const q = await load(BrandQueueSchema, '/api/catalog/v1/brand-applications/queue');
  return (
    <StaffFrame session={g.session} current="/admin/brands" title="Brand Registry" intro="Check the trademark on the IP India register and that the applicant owns it (or is the manufacturer / authorised agent). Approved owners control the brand’s product pages and resellers.">
      {ok && <Notice tone="success">{ok}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      {!q.ok ? (
        <Unavailable what="Catalog service" reason={q.error} />
      ) : (
        <>
          <KpiGrid>
            <KpiTile icon={Glyph.clock} label="Waiting for review" value={fmtInt(q.data.items.length)} />
            <KpiTile icon={Glyph.doc} label="Pending trademarks" value={fmtInt(q.data.items.filter((a) => a.trademarkStatus === 'PENDING').length)} hint="filed, not yet registered" />
          </KpiGrid>
          {q.data.items.length === 0 && (
            <Panel title="Queue">
              <p className="text-[14px] text-[var(--muted)]">No brand applications waiting.</p>
            </Panel>
          )}
          {q.data.items.map((a) => (
            <Panel key={a.applicationId} title={a.brandName} subtitle={`by ${a.sellerName} (${REL[a.relationship] ?? a.relationship}) · submitted ${fmtDate(a.submittedAt)}`}>
              <div className="grid gap-4 md:grid-cols-2">
                <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-[var(--muted)]">Trademark no.</dt>
                  <dd className="font-mono">{a.trademarkNumber}</dd>
                  <dt className="text-[var(--muted)]">Trademark status</dt>
                  <dd>
                    <StatusBadge tone={a.trademarkStatus === 'REGISTERED' ? 'good' : 'warning'}>{a.trademarkStatus.toLowerCase()}</StatusBadge>
                  </dd>
                  <dt className="text-[var(--muted)]">Resellers</dt>
                  <dd>{a.restrictResellers ? 'by authorisation only' : 'open to all'}</dd>
                  <dt className="text-[var(--muted)]">Evidence</dt>
                  <dd>{a.evidenceUrl ? <TextLink href={a.evidenceUrl} target="_blank" rel="noreferrer noopener">open link ↗</TextLink> : 'none provided'}</dd>
                </dl>
                <CheckList checks={a.checks} />
              </div>
              <div className="mt-3">
                <DecisionForm action={decide} id={a.applicationId} version={a.version} noteRequiredHint="Required when rejecting — the applicant sees it." />
              </div>
            </Panel>
          ))}
        </>
      )}
    </StaffFrame>
  );
}
