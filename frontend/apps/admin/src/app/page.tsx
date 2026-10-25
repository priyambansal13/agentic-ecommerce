import { load } from '@ac/bff';
import { AdminOverviewDashboardSchema, CatalogDashboardSchema, FraudDashboardSchema, PlatformHealthSchema, PlatformOrdersDashboardSchema, SupportDashboardSchema } from '@ac/contracts';
import { BarChart, DataTable, fmtDay, fmtInt, fmtMoney, fmtMoneyCompact, KpiGrid, KpiTile, Panel, StatusBadge, Unavailable, Glyph } from '@ac/ui';
import { requireStaff, StaffFrame } from '../lib/guard';

export const dynamic = 'force-dynamic';

/** Admin overview (role admin): business pulse + live health of every microservice, each from its owner. */
export default async function AdminOverview() {
  const g = await requireStaff('/admin');
  if ('denied' in g) return g.denied;
  const [health, orders, catalog, ops, fraud, support] = await Promise.all([
    load(PlatformHealthSchema, '/api/admin/v1/dashboard/platform-health'),
    load(PlatformOrdersDashboardSchema, '/api/order/v1/dashboard/platform'),
    load(CatalogDashboardSchema, '/api/catalog/v1/dashboard'),
    load(AdminOverviewDashboardSchema, '/api/admin/v1/dashboard/overview'),
    load(FraudDashboardSchema, '/api/fraud/v1/dashboard'),
    load(SupportDashboardSchema, '/api/returns/v1/dashboard/support'),
  ]);
  const cur = orders.ok ? orders.data.currency : 'INR';
  const down = health.ok ? health.data.services.filter((s) => s.status !== 'ok').length : null;

  return (
    <StaffFrame session={g.session} current="/admin" title="Platform overview" intro="Business pulse and the health of every microservice.">
      {orders.ok ? (
        <KpiGrid>
          <KpiTile icon={Glyph.money} label="GMV (30 days)" value={fmtMoney(orders.data.kpis.gmv30dMinor, cur)} />
          <KpiTile icon={Glyph.cart} label="Orders (30 days)" value={fmtInt(orders.data.kpis.orders30d)} />
          <KpiTile icon={Glyph.tag} label="Average order" value={fmtMoney(orders.data.kpis.aovMinor, cur)} />
          <KpiTile icon={Glyph.users} label="Active buyers (30 days)" value={fmtInt(orders.data.kpis.activeBuyers30d)} />
        </KpiGrid>
      ) : (
        <Unavailable what="Order metrics" reason={orders.error} />
      )}

      <Panel title="GMV per day" subtitle="last 30 days">
        {orders.ok ? <BarChart ariaLabel="GMV per day, last 30 days" data={orders.data.gmvByDay.map((d) => ({ label: fmtDay(d.day), value: d.value }))} format={(v) => fmtMoneyCompact(v, cur)} /> : <Unavailable what="GMV chart" reason={orders.error} />}
      </Panel>

      <KpiGrid>
        <KpiTile icon={Glyph.box} label="Live products" value={catalog.ok ? fmtInt(catalog.data.published) : '—'} hint={catalog.ok ? `${catalog.data.sellers} sellers` : catalog.error} />
        <KpiTile icon={Glyph.gavel} label="Awaiting moderation" value={ops.ok ? fmtInt(ops.data.pendingModeration) : '—'} hint={ops.ok ? `${ops.data.openDisputes} open disputes` : ops.error} />
        <KpiTile icon={Glyph.refund} label="Refunds needing a human" value={support.ok ? fmtInt(support.data.kpis.pendingHuman) : '—'} hint={support.ok ? `${support.data.kpis.autoApproved7d} auto-approved (7 days)` : support.error} />
        <KpiTile icon={Glyph.alert} label="Open fraud alerts" value={fraud.ok ? fmtInt(fraud.data.kpis.open) : '—'} hint={fraud.ok ? `${fraud.data.kpis.investigating} investigating` : fraud.error} />
      </KpiGrid>

      <Panel title="Service health" subtitle={health.ok ? `${health.data.services.length} microservices · ${down === 0 ? 'all healthy' : `${down} not healthy`}` : undefined}>
        {health.ok ? (
          <DataTable
            caption="Service health"
            rows={health.data.services}
            columns={[
              { key: 'name', label: 'Service', render: (s) => s.name },
              { key: 'status', label: 'Status', render: (s) => <StatusBadge tone={s.status === 'ok' ? 'good' : s.status === 'degraded' ? 'warning' : 'critical'}>{s.status}</StatusBadge> },
              { key: 'db', label: 'Own database', render: (s) => (s.db === 'none' ? '—' : <StatusBadge tone={s.db === 'up' ? 'good' : 'critical'}>{s.db}</StatusBadge>) },
              { key: 'lat', label: 'Latency', align: 'right', render: (s) => `${Math.round(s.latencyMs)} ms` },
            ]}
          />
        ) : (
          <Unavailable what="Platform health" reason={health.error} />
        )}
      </Panel>
    </StaffFrame>
  );
}
