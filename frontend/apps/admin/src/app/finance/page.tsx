import { load } from '@ac/bff';
import { CaseQueueSchema, FinancePaymentsDashboardSchema, FinanceRefundsDashboardSchema } from '@ac/contracts';
import { BarChart, DataTable, fmtAge, fmtDay, fmtMoney, fmtMoneyCompact, fmtPct, KpiGrid, KpiTile, Panel, StatusBadge, Unavailable, Glyph } from '@ac/ui';
import { requireStaff, StaffFrame } from '../../lib/guard';
import { REASON } from '../../lib/refunds';

export const dynamic = 'force-dynamic';

/** Finance (finance, admin): captures, refunds, payouts, ledger integrity and dual-control refund approvals. */
export default async function FinanceDashboard() {
  const g = await requireStaff('/admin/finance');
  if ('denied' in g) return g.denied;
  const [pay, ref, second] = await Promise.all([
    load(FinancePaymentsDashboardSchema, '/api/payment/v1/dashboard/finance'),
    load(FinanceRefundsDashboardSchema, '/api/returns/v1/dashboard/finance'),
    load(CaseQueueSchema, '/api/returns/v1/refund-cases/queue?role=finance'),
  ]);
  const cur = pay.ok ? pay.data.currency : 'INR';
  return (
    <StaffFrame session={g.session} current="/admin/finance" title="Finance" intro="Money in, money out, and whether the books balance.">
      {pay.ok ? (
        <>
          <KpiGrid>
            <KpiTile icon={Glyph.money} label="Captured (30 days)" value={fmtMoney(pay.data.kpis.captured30dMinor, cur)} />
            <KpiTile icon={Glyph.refund} label="Refunded (30 days)" value={fmtMoney(pay.data.kpis.refunded30dMinor, cur)} />
            <KpiTile icon={Glyph.clock} label="Payouts pending" value={fmtMoney(pay.data.kpis.payoutsPendingMinor, cur)} />
            <KpiTile icon={Glyph.money} label="Paid to sellers (30 days)" value={fmtMoney(pay.data.kpis.payoutsPaid30dMinor, cur)} />
          </KpiGrid>
          <Panel title="Ledger integrity" subtitle="double-entry: Σ debits must equal Σ credits">
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge tone={pay.data.ledger.balanced ? 'good' : 'critical'}>{pay.data.ledger.balanced ? 'balanced' : 'OUT OF BALANCE'}</StatusBadge>
              <span className="tabular-nums">debits {fmtMoney(pay.data.ledger.debitMinor, cur)}</span>
              <span className="tabular-nums">credits {fmtMoney(pay.data.ledger.creditMinor, cur)}</span>
            </p>
          </Panel>
          {pay.data.fees && (
            <Panel title="Platform fee revenue" subtitle="last 30 days · charged to sellers per order under the fee schedule in force when the order was placed">
              <KpiGrid>
                <KpiTile icon={Glyph.percent} label="Total fees" value={fmtMoney(pay.data.fees.totalMinor, cur)} hint={<a className="text-[var(--link)] hover:underline" href="/admin/fees">fee schedule</a>} />
                <KpiTile icon={Glyph.percent} label="Referral" value={fmtMoney(pay.data.fees.referralMinor, cur)} />
                <KpiTile icon={Glyph.tag} label="Closing + payment" value={fmtMoney(pay.data.fees.closingMinor + pay.data.fees.paymentMinor, cur)} />
                <KpiTile icon={Glyph.doc} label="GST on fees" value={fmtMoney(pay.data.fees.gstMinor, cur)} hint="payable to government" />
              </KpiGrid>
            </Panel>
          )}
          <Panel title="Captured per day" subtitle="last 30 days">
            <BarChart ariaLabel="Payments captured per day" data={pay.data.capturedByDay.map((d) => ({ label: fmtDay(d.day), value: d.value }))} format={(v) => fmtMoneyCompact(v, cur)} />
          </Panel>
        </>
      ) : (
        <Unavailable what="Payment service" reason={pay.error} />
      )}
      <Panel title="Refunds awaiting second approval" subtitle="dual control: support approved first; a finance user who did not give the first approval decides">
        {second.ok ? (
          <DataTable
            caption="Refund cases awaiting a finance second approval"
            empty="No refunds waiting for a second approval."
            rows={second.data.items}
            columns={[
              { key: 'order', label: 'Order', render: (c) => <a className="text-[var(--link)] hover:underline" href={`/admin/support/${c.caseId}`}>{c.orderNo}</a> },
              { key: 'reason', label: 'Reason', render: (c) => REASON[c.reasonCode] ?? c.reasonCode },
              { key: 'amt', label: 'Requested', align: 'right', render: (c) => fmtMoney(c.requestedMinor, second.data.currency) },
              { key: 'age', label: 'Waiting', align: 'right', render: (c) => fmtAge((Date.now() - Date.parse(c.openedAt)) / 3_600_000) },
              { key: 'go', label: '', render: (c) => <a className="text-[var(--link)] hover:underline" href={`/admin/support/${c.caseId}`}>Review</a> },
            ]}
          />
        ) : (
          <Unavailable what="Second-approval queue" reason={second.error} />
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Refunds awaiting finance" subtitle={ref.ok ? `dual control above the threshold · ${fmtPct(ref.data.autoApprovedShare30d)} of 30-day refunds were auto-approved` : undefined}>
          {ref.ok ? (
            <DataTable
              caption="Refunds awaiting finance approval"
              empty="No high-value refunds waiting."
              rows={ref.data.awaitingFinance}
              columns={[
                { key: 'order', label: 'Order', render: (c) => <a className="text-[var(--link)] hover:underline" href={`/admin/support/${c.caseId}`}>{c.orderNo}</a> },
                { key: 'amt', label: 'Amount', align: 'right', render: (c) => fmtMoney(c.proposedMinor ?? c.requestedMinor, ref.data.currency) },
                { key: 'age', label: 'Waiting', align: 'right', render: (c) => fmtAge(c.ageHours) },
              ]}
            />
          ) : (
            <Unavailable what="Returns service" reason={ref.error} />
          )}
        </Panel>
        <Panel title="Upcoming payouts">
          {pay.ok ? (
            <DataTable
              caption="Upcoming payouts"
              rows={pay.data.upcomingPayouts}
              columns={[
                { key: 'seller', label: 'Seller', render: (p) => p.sellerName },
                { key: 'on', label: 'On', render: (p) => fmtDay(p.scheduledOn) },
                { key: 'amt', label: 'Amount', align: 'right', render: (p) => fmtMoney(p.amountMinor, cur) },
              ]}
            />
          ) : (
            <Unavailable what="Payouts" reason={pay.error} />
          )}
        </Panel>
      </div>
    </StaffFrame>
  );
}
