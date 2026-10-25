import { Injectable } from '@nestjs/common';
import { SellerSalesDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';

const CURRENCY = 'INR';
const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async seller(sellerId: string) {
    const [k] = await this.db.query(
      `SELECT coalesce(sum(gross_minor), 0) AS gross, coalesce(sum(orders), 0) AS orders, coalesce(sum(refunds_minor), 0) AS refunds
         FROM daily_sales WHERE seller_id = $1 AND day > current_date - 30`,
      [sellerId],
    );
    const byDay = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(s.gross_minor, 0) AS v
         FROM generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') d
         LEFT JOIN daily_sales s ON s.seller_id = $1 AND s.day = d::date
        ORDER BY d`,
      [sellerId],
    );
    const top = await this.db.query(`SELECT product_id, title, units, gross_minor FROM product_sales WHERE seller_id = $1 ORDER BY gross_minor DESC LIMIT 5`, [sellerId]);
    const [p] = await this.db.query(
      `SELECT coalesce(sum(amount_minor) FILTER (WHERE status = 'PENDING'), 0) AS pending,
              to_char(min(scheduled_on) FILTER (WHERE status = 'PENDING'), 'YYYY-MM-DD') AS next_on
         FROM seller_payouts WHERE seller_id = $1`,
      [sellerId],
    );
    const recent = await this.db.query(
      `SELECT to_char(scheduled_on, 'YYYY-MM-DD') AS paid_on, amount_minor FROM seller_payouts
        WHERE seller_id = $1 AND status = 'PAID' ORDER BY scheduled_on DESC LIMIT 5`,
      [sellerId],
    );
    // "today" = the current UTC day of the read model
    const [t] = await this.db.query(
      `SELECT coalesce(sum(gross_minor), 0) AS gross, coalesce(sum(orders), 0) AS orders, coalesce(sum(units), 0) AS units
         FROM daily_sales WHERE seller_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`,
      [sellerId],
    );
    const gross = n(k.gross);
    const orders = n(k.orders);
    return SellerSalesDashboardSchema.parse({
      currency: CURRENCY,
      kpis: { gmv30dMinor: gross, orders30d: orders, aovMinor: orders ? Math.round(gross / orders) : 0, refundRate30d: gross ? Math.round((n(k.refunds) / gross) * 1000) / 1000 : 0 },
      today: { gmvMinor: n(t.gross), orders: n(t.orders), units: n(t.units) },
      salesByDay: byDay.map((r: any) => ({ day: r.day, value: n(r.v) })),
      topProducts: top.map((r: any) => ({ productId: r.product_id, title: r.title, units: r.units, grossMinor: n(r.gross_minor) })),
      payouts: { pendingMinor: n(p.pending), nextPayoutOn: p.next_on, recent: recent.map((r: any) => ({ paidOn: r.paid_on, amountMinor: n(r.amount_minor) })) },
    });
  }
}
