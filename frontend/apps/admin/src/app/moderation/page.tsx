import { load, send } from '@ac/bff';
import { CatalogDashboardSchema, ModerationDashboardSchema, productImageUrl } from '@ac/contracts';
import { DataTable, fmtAge, fmtInt, fmtPct, HBarChart, KpiGrid, KpiTile, Notice, Panel, ProductImage, StatusBadge, SubmitButton, type Tone, Unavailable, Glyph } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decisionError, flash } from '../../lib/decide';
import { requireStaff, StaffFrame } from '../../lib/guard';

export const dynamic = 'force-dynamic';
/** Queue items carry `version` (contracts 0.4.1) — buttons hidden when absent. */
const Item = ModerationDashboardSchema.shape.queue.element;
const Dashboard = ModerationDashboardSchema.extend({ queue: z.array(Item) });

async function decide(fd: FormData) {
  'use server';
  const decision = String(fd.get('decision'));
  const r = await send('POST', `/api/admin/v1/moderation/${String(fd.get('id'))}/decision`, { decision, note: String(fd.get('note') ?? '').trim(), version: Number(fd.get('version')) });
  revalidatePath('/moderation');
  redirect(r.ok ? flash('/moderation', 'ok', decision === 'APPROVE' ? 'Listing approved — it is live in the catalogue.' : 'Listing rejected — the seller sees your note.') : flash('/moderation', 'err', decisionError(r)));
}

const verdictTone = (v: string): Tone => (v === 'APPROVE' ? 'good' : v === 'REJECT' ? 'critical' : 'warning');

/** Moderation (moderator, admin): listings the moderation agent could not auto-approve (A6). */
export default async function ModerationDashboard({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const g = await requireStaff('/admin/moderation');
  if ('denied' in g) return g.denied;
  const { ok, err } = await searchParams;
  const [mod, cat] = await Promise.all([load(Dashboard, '/api/admin/v1/dashboard/moderation'), load(CatalogDashboardSchema, '/api/catalog/v1/dashboard')]);
  return (
    <StaffFrame session={g.session} current="/admin/moderation" title="Moderation" intro="Low-risk listings are auto-approved by the agent; everything else is decided here.">
      {ok && <Notice tone="success">{ok}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      {mod.ok ? (
        <KpiGrid>
          <KpiTile icon={Glyph.inbox} label="In queue" value={fmtInt(mod.data.kpis.pending)} />
          <KpiTile icon={Glyph.bot} label="Auto-approved (7 days)" value={fmtInt(mod.data.kpis.autoApproved7d)} />
          <KpiTile icon={Glyph.users} label="Human decisions (7 days)" value={fmtInt(mod.data.kpis.humanDecided7d)} />
          <KpiTile icon={Glyph.bot} label="Auto-approval rate" value={fmtPct(mod.data.kpis.autoApprovalRate7d)} hint="7 days" />
        </KpiGrid>
      ) : (
        <Unavailable what="Admin service" reason={mod.error} />
      )}
      <div className="space-y-4">
        <Panel title="Queue" subtitle="agent verdict, confidence and reasons — click a photo for full size">
          {mod.ok ? (
            <DataTable
              caption="Moderation queue"
              empty="Queue is empty."
              rows={mod.data.queue}
              columns={[
                {
                  key: 'title',
                  label: 'Listing',
                  render: (i) => (
                    <span className="flex min-w-[14rem] items-start gap-2">
                      {i.productId ? (
                        <a href={productImageUrl(i.productId, 'full')} target="_blank" rel="noopener noreferrer" title="Open the full-size photo" className="rounded-md border border-[var(--line)] bg-white p-0.5">
                          <ProductImage src={productImageUrl(i.productId, 'thumb')} category={i.category ?? ''} title={i.title} box={56} />
                        </a>
                      ) : (
                        <ProductImage src={null} category={i.category ?? ''} title={i.title} box={56} />
                      )}
                      <span>
                        <span className="block">{i.title}</span>
                        {(i.brand || i.category) && <span className="block text-xs text-[var(--muted)]">{[i.brand, i.category].filter(Boolean).join(' · ')}</span>}
                      </span>
                    </span>
                  ),
                },
                { key: 'seller', label: 'Seller', render: (i) => i.sellerName },
                { key: 'v', label: 'Agent', render: (i) => <StatusBadge tone={verdictTone(i.agentVerdict)}>{i.agentVerdict.toLowerCase().replace('_', ' ')} · {i.confidence.toFixed(2)}</StatusBadge> },
                { key: 'why', label: 'Reasons', render: (i) => <span className="block min-w-[9rem] text-xs text-[var(--muted)]">{i.reasons.join(', ') || '—'}</span> },
                { key: 'age', label: 'Waiting', align: 'right', render: (i) => fmtAge(i.ageHours) },
                {
                  key: 'act',
                  label: 'Decision',
                  render: (i) =>
                    i.itemId && i.version !== undefined ? (
                      <form action={decide} className="flex min-w-[14rem] flex-col gap-1">
                        <input type="hidden" name="id" value={i.itemId} />
                        <input type="hidden" name="version" value={i.version} />
                        <input name="note" placeholder="note for the seller" aria-label={`Note for ${i.title}`} maxLength={500} className="rounded-[3px] border border-[#888c8c] bg-white px-2 py-1 text-[12px] text-[#0f1111]" />
                        <span className="flex gap-1">
                          <SubmitButton name="decision" value="APPROVE" className="px-3 py-1 text-[12px]">
                            Approve
                          </SubmitButton>
                          <SubmitButton name="decision" value="REJECT" variant="danger" className="px-3 py-1 text-[12px]">
                            Reject
                          </SubmitButton>
                        </span>
                      </form>
                    ) : (
                      <span className="text-[12px] text-[var(--muted)]">—</span>
                    ),
                },
              ]}
            />
          ) : (
            <Unavailable what="Queue" reason={mod.error} />
          )}
        </Panel>
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Agent verdicts" subtitle="7 days">
            {mod.ok ? <HBarChart ariaLabel="Agent verdicts, 7 days" data={mod.data.verdicts7d.map((v) => ({ label: v.verdict.toLowerCase().replace('_', ' '), value: v.count }))} /> : <Unavailable what="Verdicts" reason={mod.error} />}
          </Panel>
          <Panel title="Catalogue">
            {cat.ok ? (
              <HBarChart
                ariaLabel="Listings by status"
                data={[
                  { label: 'published', value: cat.data.published },
                  { label: 'pending review', value: cat.data.pendingReview },
                  { label: 'draft', value: cat.data.draft },
                  { label: 'rejected', value: cat.data.rejected },
                ]}
              />
            ) : (
              <Unavailable what="Catalog service" reason={cat.error} />
            )}
          </Panel>
        </div>
      </div>
    </StaffFrame>
  );
}
