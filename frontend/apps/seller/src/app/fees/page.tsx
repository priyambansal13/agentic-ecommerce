import { getSession, hasRole, load, loadPublic } from '@ac/bff';
import { CategoriesSchema, FeeScheduleSchema, SellerFeesSchema } from '@ac/contracts';
import { Card, DataTable, fmtDate, fmtMoney, KpiGrid, KpiTile, Unavailable } from '@ac/ui';
import { FeeCalculator } from '../../components/fee-calculator';
import { bandText, bps } from '../../lib/fees';
import { SellerNav, SellerPage } from '../../lib/nav';

export const dynamic = 'force-dynamic';

/** Selling fees: public rate card (payment GET /v1/fees/schedule) + calculator; sellers also see their fees (30 days). */
export default async function Fees() {
  const session = await getSession();
  const seller = hasRole(session, 'seller');
  const [sched, cats, mine] = await Promise.all([
    loadPublic(FeeScheduleSchema, '/api/payment/v1/fees/schedule'),
    loadPublic(CategoriesSchema, '/api/catalog/v1/categories'),
    seller ? load(SellerFeesSchema, '/api/payment/v1/sellers/me/fees') : Promise.resolve(null),
  ]);
  const name = (id: string) => (cats.ok ? cats.data.categories.find((c) => c.id === id)?.name : undefined) ?? id;
  const calcCats = sched.ok ? sched.data.rules.map((r) => ({ id: r.category, name: name(r.category) })) : cats.ok ? cats.data.categories : [];
  return (
    <div>
      {seller && session && <SellerNav current="/seller/fees" name={session.name} />}
      <SellerPage
        title="Selling fees"
        crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Fees' }]}
        intro="You pay only when you sell: a referral fee (a percentage of the sale price, by category), a fixed closing fee by price band, and a payment-collection fee. 18% GST applies to the fees. No monthly subscription."
      >
        {mine && (
          <Card title="Your fees · last 30 days">
            {mine.ok ? (
              <>
                <KpiGrid>
                  <KpiTile label="Sales" value={fmtMoney(mine.data.totals.salesMinor, mine.data.currency)} />
                  <KpiTile label="Total fees" value={fmtMoney(mine.data.totals.totalFeesMinor, mine.data.currency)} hint={mine.data.totals.salesMinor ? `${((mine.data.totals.totalFeesMinor / mine.data.totals.salesMinor) * 100).toFixed(1)}% of sales` : undefined} />
                  <KpiTile label="Referral fees" value={fmtMoney(mine.data.totals.referralMinor, mine.data.currency)} />
                  <KpiTile label="Closing + payment" value={fmtMoney(mine.data.totals.closingMinor + mine.data.totals.paymentMinor, mine.data.currency)} hint={`GST ${fmtMoney(mine.data.totals.gstMinor, mine.data.currency)}`} />
                </KpiGrid>
                <div className="mt-3">
                  <DataTable
                    caption="Fees by category, last 30 days"
                    empty="No sales in the last 30 days."
                    rows={mine.data.byCategory}
                    columns={[
                      { key: 'c', label: 'Category', render: (r) => name(r.category) },
                      { key: 's', label: 'Sales', align: 'right', render: (r) => fmtMoney(r.salesMinor, mine.data.currency) },
                      { key: 'f', label: 'Fees', align: 'right', render: (r) => fmtMoney(r.feesMinor, mine.data.currency) },
                      { key: 'p', label: 'Effective rate', align: 'right', render: (r) => (r.salesMinor ? `${((r.feesMinor / r.salesMinor) * 100).toFixed(1)}%` : '—') },
                    ]}
                  />
                </div>
              </>
            ) : (
              <Unavailable what="Your fees" reason={mine.error} />
            )}
          </Card>
        )}

        <Card title="Fee calculator">
          {calcCats.length ? <FeeCalculator categories={calcCats} /> : <Unavailable what="Categories" reason={cats.ok ? 'none' : cats.error} />}
        </Card>

        {sched.ok ? (
          <Card title={`Rate card · version ${sched.data.version}`} actions={<span className="text-[12px] text-[var(--muted)]">{sched.data.effectiveFrom ? `effective ${fmtDate(sched.data.effectiveFrom)}` : ''}</span>}>
            <DataTable
              caption="Referral and closing fees by category"
              rows={sched.data.rules}
              columns={[
                { key: 'c', label: 'Category', render: (r) => <b>{name(r.category)}</b> },
                { key: 'r', label: 'Referral fee', align: 'right', render: (r) => bps(r.referralBps) },
                { key: 'm', label: 'Minimum referral', align: 'right', render: (r) => fmtMoney(r.minReferralMinor, 'INR') },
                {
                  key: 'cl',
                  label: 'Closing fee by item price',
                  render: (r) => (
                    <ul className="text-[12px]">
                      {bandText(r.closingFees).map((b) => (
                        <li key={b.range}>
                          {b.range}: <b>{b.fee}</b>
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]}
            />
            <dl className="mt-3 grid gap-2 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Payment-collection fee</dt>
                <dd>
                  <b>{bps(sched.data.paymentFeeBps)}</b> of the order value (all payment methods, incl. cash on delivery)
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">GST on fees</dt>
                <dd>
                  <b>{bps(sched.data.gstBps)}</b> — invoiced monthly; claim it as input tax credit
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-[var(--muted)]">Fee changes are announced in advance and approved by a second person in finance (maker-checker) before they take effect. The fee on an order is fixed at the time the order is placed.</p>
          </Card>
        ) : (
          <Unavailable what="Rate card" reason={sched.error} />
        )}
      </SellerPage>
    </div>
  );
}
