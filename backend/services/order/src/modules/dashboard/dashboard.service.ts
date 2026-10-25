import { Injectable } from '@nestjs/common';
import { BuyerOrdersDashboardSchema, PlatformOrdersDashboardSchema, SellerOrdersDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';
import { dashboardStatus } from '../commerce/lifecycle.js';

const CURRENCY = 'INR';
const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date | string) => new Date(d).toISOString();

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async buyer(buyerId: string) {
    const [k] = await this.db.query(
      `SELECT count(*) AS orders,
              count(*) FILTER (WHERE status IN ('PAID','CONFIRMED','PARTIALLY_SHIPPED','SHIPPED')) AS in_transit,
              count(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
              coalesce(sum(total_minor) FILTER (WHERE status NOT IN ('CANCELLED','PAYMENT_FAILED','PENDING_PAYMENT') AND placed_at > now() - interval '90 days'), 0) AS spent
         FROM orders WHERE buyer_id = $1 AND status NOT IN ('CREATED','REJECTED')`,
      [buyerId],
    );
    const recent = await this.db.query(
      `SELECT order_no, status, total_minor, items, placed_at FROM orders WHERE buyer_id = $1 AND status NOT IN ('CREATED','REJECTED') ORDER BY placed_at DESC LIMIT 10`,
      [buyerId],
    );
    return BuyerOrdersDashboardSchema.parse({
      currency: CURRENCY,
      kpis: { orders: n(k.orders), inTransit: n(k.in_transit), delivered: n(k.delivered), spent90dMinor: n(k.spent) },
      recentOrders: recent.map((r: any) => ({ orderNo: r.order_no, status: dashboardStatus(r.status), totalMinor: n(r.total_minor), items: r.items, placedAt: iso(r.placed_at) })),
    });
  }

  async seller(sellerId: string) {
    const toShip = await this.db.query(
      `SELECT o.order_no, so.items, so.total_minor, so.placed_at, extract(epoch FROM now() - so.placed_at) / 3600 AS age_h
         FROM seller_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.seller_id = $1 AND so.status IN ('CONFIRMED','PAID')
        ORDER BY so.placed_at ASC LIMIT 10`,
      [sellerId],
    );
    const byStatus = await this.db.query(`SELECT status, count(*) AS c FROM seller_orders WHERE seller_id = $1 GROUP BY status ORDER BY status`, [sellerId]);
    // account-health inputs: unshipped / late (> 48 h) and shipping performance over 30 days
    const [sh] = await this.db.query(
      `SELECT count(*) FILTER (WHERE so.status IN ('CONFIRMED','PAID')) AS unshipped,
              count(*) FILTER (WHERE so.status IN ('CONFIRMED','PAID') AND so.placed_at < now() - interval '48 hours') AS late,
              count(*) FILTER (WHERE o.shipped_at > now() - interval '30 days') AS shipped30,
              count(*) FILTER (WHERE o.shipped_at > now() - interval '30 days' AND o.shipped_at - o.placed_at > interval '48 hours') AS late_shipped30
         FROM seller_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.seller_id = $1`,
      [sellerId],
    );
    return SellerOrdersDashboardSchema.parse({
      currency: CURRENCY,
      toShip: toShip.map((r: any) => ({ orderNo: r.order_no, items: r.items, totalMinor: n(r.total_minor), placedAt: iso(r.placed_at), ageHours: Math.round(n(r.age_h) * 10) / 10 })),
      // new lifecycle statuses fold into the dashboards' (narrower) enum
      byStatus: [...byStatus.reduce((m: Map<string, number>, r: any) => m.set(dashboardStatus(r.status), (m.get(dashboardStatus(r.status)) ?? 0) + n(r.c)), new Map<string, number>())].map(([status, count]) => ({ status, count })),
      shipping: { unshipped: n(sh.unshipped), late: n(sh.late), shipped30d: n(sh.shipped30), lateShipped30d: n(sh.late_shipped30) },
    });
  }

  async platform() {
    const valid = `status NOT IN ('CANCELLED','PENDING_PAYMENT','CREATED','REJECTED','PAYMENT_FAILED')`;
    const [k] = await this.db.query(
      `SELECT coalesce(sum(total_minor), 0) AS gmv, count(*) AS orders, count(DISTINCT buyer_id) AS buyers
         FROM orders WHERE ${valid} AND placed_at > now() - interval '30 days'`,
    );
    const byDay = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(sum(o.total_minor), 0) AS v
         FROM generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') d
         LEFT JOIN orders o ON o.placed_at >= d AND o.placed_at < d + interval '1 day' AND o.${valid}
        GROUP BY d ORDER BY d`,
    );
    const orders = n(k.orders);
    return PlatformOrdersDashboardSchema.parse({
      currency: CURRENCY,
      kpis: { gmv30dMinor: n(k.gmv), orders30d: orders, aovMinor: orders ? Math.round(n(k.gmv) / orders) : 0, activeBuyers30d: n(k.buyers) },
      gmvByDay: byDay.map((r: any) => ({ day: r.day, value: n(r.v) })),
    });
  }
}
