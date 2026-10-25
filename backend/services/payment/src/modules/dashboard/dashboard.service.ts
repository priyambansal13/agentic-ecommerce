import { Injectable } from '@nestjs/common';
import { FinancePaymentsDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';
import { FeesService } from '../fees/fees.service.js';

const CURRENCY = 'INR';
const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource, private readonly fees: FeesService) {}

  async finance() {
    const [p] = await this.db.query(`SELECT coalesce(sum(amount_minor), 0) AS v FROM payments WHERE status = 'SUCCEEDED' AND captured_at > now() - interval '30 days'`);
    const [r] = await this.db.query(`SELECT coalesce(sum(amount_minor), 0) AS v FROM refunds WHERE status = 'SUCCEEDED' AND created_at > now() - interval '30 days'`);
    const [po] = await this.db.query(
      `SELECT coalesce(sum(amount_minor) FILTER (WHERE status = 'PENDING'), 0) AS pending,
              coalesce(sum(amount_minor) FILTER (WHERE status = 'PAID' AND paid_at > now() - interval '30 days'), 0) AS paid
         FROM payouts`,
    );
    const byDay = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(sum(p.amount_minor), 0) AS v
         FROM generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') d
         LEFT JOIN payments p ON p.captured_at >= d AND p.captured_at < d + interval '1 day' AND p.status = 'SUCCEEDED'
        GROUP BY d ORDER BY d`,
    );
    const upcoming = await this.db.query(
      `SELECT seller_name, amount_minor, to_char(scheduled_on, 'YYYY-MM-DD') AS on
         FROM payouts WHERE status = 'PENDING' ORDER BY scheduled_on, amount_minor DESC LIMIT 10`,
    );
    const fees = await this.fees.platformFees30d();
    const [l] = await this.db.query(`SELECT coalesce(sum(debit_minor), 0) AS d, coalesce(sum(credit_minor), 0) AS c FROM ledger_entries`);
    return FinancePaymentsDashboardSchema.parse({
      currency: CURRENCY,
      kpis: { captured30dMinor: n(p.v), refunded30dMinor: n(r.v), payoutsPendingMinor: n(po.pending), payoutsPaid30dMinor: n(po.paid) },
      capturedByDay: byDay.map((x: any) => ({ day: x.day, value: n(x.v) })),
      upcomingPayouts: upcoming.map((x: any) => ({ sellerName: x.seller_name, amountMinor: n(x.amount_minor), scheduledOn: x.on })),
      // Σdebit = Σcredit over the whole ledger (each transaction is balanced on write)
      ledger: { balanced: n(l.d) === n(l.c), debitMinor: n(l.d), creditMinor: n(l.c), checkedAt: new Date().toISOString() },
      fees,
    });
  }
}
