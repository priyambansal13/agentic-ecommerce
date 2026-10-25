import { load } from '@ac/bff';
import { CaseQueueSchema, SupportDashboardSchema } from '@ac/contracts';
import { BarChart, DataTable, fmtAge, fmtDay, fmtInt, fmtMoney, KpiGrid, KpiTile, Panel, StatusBadge, Unavailable, Glyph } from '@ac/ui';
import { requireStaff, StaffFrame } from '../../lib/guard';
import { caseLabel, caseTone, REASON, riskTone } from '../../lib/refunds';

export const dynamic = 'force-dynamic';

/** Support (support, admin): refund cases the refund agent escalated for a human decision (docs 03 · A1). */
export default async function SupportDashboard() {
  const g = await requireStaff('/admin/support');
  if ('denied' in g) return g.denied;
  const [d, q] = await Promise.all([load(SupportDashboardSchema, '/api/returns/v1/dashboard/support'), load(CaseQueueSchema, '/api/returns/v1/refund-cases/queue?role=support')]);
  if (!d.ok) return <StaffFrame session={g.session} current="/admin/support" title="Support"><Unavailable what="Returns service" reason={d.error} /></StaffFrame>;
  const { kpis, queue, resolvedByDay, currency } = d.data;
  return (
    <StaffFrame session={g.session} current="/admin/support" title="Support — refund approvals" intro="Cases outside the agent's auto-approve envelope wait here for a person.">
      <KpiGrid>
        <KpiTile icon={Glyph.users} label="Needing a human" value={fmtInt(kpis.pendingHuman)} hint={`${queue.length} for support · ${Math.max(0, kpis.pendingHuman - queue.length)} for finance (dual control)`} />
        <KpiTile icon={Glyph.bot} label="Auto-approved (7 days)" value={fmtInt(kpis.autoApproved7d)} hint="inside policy envelope" />
        <KpiTile icon={Glyph.alert} label="Approved / rejected (7 days)" value={`${fmtInt(kpis.approved7d)} / ${fmtInt(kpis.rejected7d)}`} />
        <KpiTile icon={Glyph.clock} label="Median time to resolve" value={fmtAge(kpis.medianHoursToResolve)} />
      </KpiGrid>
      <Panel title="Cases to decide" subtitle="live queue · oldest first · open a case to see the claim, evidence and policy">
        {q.ok ? (
          <DataTable
            caption="Refund cases waiting for a support decision"
            empty="Nothing waiting — the queue is empty."
            rows={q.data.items}
            columns={[
              { key: 'order', label: 'Order', render: (c) => <a className="text-[var(--link)] hover:underline" href={`/admin/support/${c.caseId}`}>{c.orderNo}</a> },
              { key: 'reason', label: 'Reason', render: (c) => REASON[c.reasonCode] ?? c.reasonCode },
              { key: 'st', label: 'Status', render: (c) => <StatusBadge tone={caseTone(c.status)}>{caseLabel(c.status)}</StatusBadge> },
              { key: 'req', label: 'Requested', align: 'right', render: (c) => fmtMoney(c.requestedMinor, q.data.currency) },
              { key: 'risk', label: 'Risk', align: 'right', render: (c) => (c.riskScore === null ? '—' : <StatusBadge tone={riskTone(c.riskScore)}>{c.riskScore.toFixed(2)}</StatusBadge>) },
              { key: 'dc', label: 'Dual control', render: (c) => (c.dualControl ? <StatusBadge tone="warning">support + finance</StatusBadge> : '—') },
              { key: 'age', label: 'Waiting', align: 'right', render: (c) => fmtAge((Date.now() - Date.parse(c.openedAt)) / 3_600_000) },
            ]}
          />
        ) : (
          <Unavailable what="Live refund queue" reason={q.error} />
        )}
      </Panel>
      <Panel title="Escalated cases (dashboard)" subtitle="oldest first · agent rationale included">
        <DataTable
          caption="Refund cases waiting for support"
          empty="Queue is empty."
          rows={queue}
          columns={[
            { key: 'order', label: 'Order', render: (c) => <a className="text-[var(--link)] hover:underline" href={`/admin/support/${c.caseId}`}>{c.orderNo}</a> },
            { key: 'reason', label: 'Reason', render: (c) => c.reason.toLowerCase().replaceAll('_', ' ') },
            { key: 'req', label: 'Requested', align: 'right', render: (c) => fmtMoney(c.requestedMinor, currency) },
            { key: 'risk', label: 'Risk', align: 'right', render: (c) => (c.riskScore === null ? '—' : <StatusBadge tone={c.riskScore >= 0.6 ? 'critical' : c.riskScore >= 0.3 ? 'warning' : 'good'}>{c.riskScore.toFixed(2)}</StatusBadge>) },
            { key: 'why', label: 'Agent rationale', render: (c) => <span className="text-xs text-[var(--muted)]">{c.agentRationale ?? '—'}</span> },
            { key: 'age', label: 'Waiting', align: 'right', render: (c) => <StatusBadge tone={c.ageHours > 24 ? 'serious' : 'neutral'}>{fmtAge(c.ageHours)}</StatusBadge> },
          ]}
        />
      </Panel>
      <Panel title="Cases resolved per day" subtitle="last 14 days">
        <BarChart ariaLabel="Refund cases resolved per day" height={130} data={resolvedByDay.map((p) => ({ label: fmtDay(p.day), value: p.value }))} format={(v) => fmtInt(Math.round(v))} labelEvery={2} />
      </Panel>
    </StaffFrame>
  );
}
