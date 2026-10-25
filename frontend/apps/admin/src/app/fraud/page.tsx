import { load } from '@ac/bff';
import { FraudDashboardSchema } from '@ac/contracts';
import { DataTable, fmtAge, fmtInt, HBarChart, KpiGrid, KpiTile, Panel, StatusBadge, type Tone, Unavailable, Glyph } from '@ac/ui';
import { requireStaff, StaffFrame } from '../../lib/guard';

export const dynamic = 'force-dynamic';

const statusTone = (s: string): Tone => (s === 'OPEN' ? 'serious' : s === 'INVESTIGATING' ? 'warning' : s === 'CONFIRMED_FRAUD' ? 'critical' : 'neutral');
const decisionTone = (d: string): Tone => (d === 'BLOCK' ? 'critical' : d === 'REVIEW' ? 'warning' : 'neutral');

/** Fraud (fraud-analyst, admin): rule-engine alerts; the fraud investigation agent will attach briefs (A7). */
export default async function FraudDashboard() {
  const g = await requireStaff('/admin/fraud');
  if ('denied' in g) return g.denied;
  const d = await load(FraudDashboardSchema, '/api/fraud/v1/dashboard');
  if (!d.ok) return <StaffFrame session={g.session} current="/admin/fraud" title="Fraud"><Unavailable what="Fraud service" reason={d.error} /></StaffFrame>;
  const { kpis, scoreBuckets, topRules, recentAlerts } = d.data;
  return (
    <StaffFrame session={g.session} current="/admin/fraud" title="Fraud — alerts & risk" intro="Rules decide in real time; analysts confirm or clear.">
      <KpiGrid>
        <KpiTile icon={Glyph.alert} label="Open" value={fmtInt(kpis.open)} />
        <KpiTile icon={Glyph.alert} label="Investigating" value={fmtInt(kpis.investigating)} />
        <KpiTile icon={Glyph.check} label="Confirmed (30 days)" value={fmtInt(kpis.confirmed30d)} />
        <KpiTile icon={Glyph.shield} label="False positives (30 days)" value={fmtInt(kpis.falsePositive30d)} />
      </KpiGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Risk score distribution" subtitle="alerts by score band">
          <HBarChart ariaLabel="Alerts by risk score band" data={scoreBuckets.map((b) => ({ label: b.bucket, value: b.count }))} />
        </Panel>
        <Panel title="Top rules" subtitle="how often each rule fired">
          <HBarChart ariaLabel="Rule hits" data={topRules.map((r) => ({ label: r.rule.replaceAll('_', ' '), value: r.count }))} />
        </Panel>
      </div>
      <Panel title="Recent alerts">
        <DataTable
          caption="Recent fraud alerts"
          rows={recentAlerts}
          columns={[
            { key: 'subj', label: 'Subject', render: (a) => a.subject },
            { key: 'score', label: 'Score', align: 'right', render: (a) => a.score.toFixed(2) },
            { key: 'dec', label: 'Decision', render: (a) => <StatusBadge tone={decisionTone(a.decision)}>{a.decision.toLowerCase()}</StatusBadge> },
            { key: 'rules', label: 'Rules', render: (a) => <span className="text-xs text-[var(--muted)]">{a.rules.join(', ').replaceAll('_', ' ')}</span> },
            { key: 'status', label: 'Status', render: (a) => <StatusBadge tone={statusTone(a.status)}>{a.status.toLowerCase().replaceAll('_', ' ')}</StatusBadge> },
            { key: 'age', label: 'Raised', align: 'right', render: (a) => `${fmtAge((Date.now() - Date.parse(a.raisedAt)) / 3_600_000)} ago` },
          ]}
        />
      </Panel>
    </StaffFrame>
  );
}
