import { Injectable } from '@nestjs/common';
import { BuyAgainSchema, BuyerOrdersPageSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';
import { dashboardStatus } from '../commerce/lifecycle.js';
import type { MyOrdersQuery } from './orders.query.js';

const CURRENCY = 'INR';
const PAGE_SIZE = 10;
const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const TAB_FILTER: Record<MyOrdersQuery['tab'], string> = {
  all: 'TRUE',
  'not-shipped': `status IN ('PENDING_PAYMENT','PAID','CONFIRMED','PARTIALLY_SHIPPED')`,
  cancelled: `status IN ('CANCELLED','PAYMENT_FAILED')`,
};
const RANGE_MONTHS: Record<MyOrdersQuery['range'], number> = { '3m': 3, '6m': 6, '12m': 12 };
const ETA_DAYS = 4;

/** "Your Orders" for the signed-in buyer — only rows where buyer_id = principal. */
@Injectable()
export class OrdersService {
  constructor(private readonly db: DataSource) {}

  async mine(buyerId: string, q: MyOrdersQuery) {
    const since = `placed_at > now() - make_interval(months => ${RANGE_MONTHS[q.range]}) AND status NOT IN ('CREATED','REJECTED')`;
    const [c] = await this.db.query(
      `SELECT count(*) AS all, count(*) FILTER (WHERE ${TAB_FILTER['not-shipped']}) AS not_shipped, count(*) FILTER (WHERE ${TAB_FILTER.cancelled}) AS cancelled
         FROM orders WHERE buyer_id = $1 AND ${since}`,
      [buyerId],
    );
    const counts = { all: n(c.all), notShipped: n(c.not_shipped), cancelled: n(c.cancelled) };
    const total = q.tab === 'all' ? counts.all : q.tab === 'cancelled' ? counts.cancelled : counts.notShipped;
    const orders = await this.db.query(
      `SELECT id, order_no, status, placed_at, total_minor, ship_to_name, ship_to_city, shipped_at, delivered_at, payment_id
         FROM orders WHERE buyer_id = $1 AND ${since} AND ${TAB_FILTER[q.tab]}
        ORDER BY placed_at DESC LIMIT ${PAGE_SIZE} OFFSET $2`,
      [buyerId, (q.page - 1) * PAGE_SIZE],
    );
    const lines = orders.length
      ? await this.db.query(
          `SELECT order_id, product_id, title, category, seller_name, qty, unit_price_minor FROM order_lines WHERE order_id = ANY($1::uuid[]) ORDER BY id`,
          [orders.map((o: any) => o.id)],
        )
      : [];
    return BuyerOrdersPageSchema.parse({
      currency: CURRENCY,
      tab: q.tab,
      range: q.range,
      page: q.page,
      pageSize: PAGE_SIZE,
      total,
      counts,
      orders: orders.map((o: any) => ({
        orderId: o.id,
        paymentId: o.payment_id ?? null,
        lifecycleStatus: o.status,
        orderNo: o.order_no,
        status: dashboardStatus(o.status),
        placedAt: iso(o.placed_at),
        totalMinor: n(o.total_minor),
        shipToName: o.ship_to_name ?? '',
        shipToCity: o.ship_to_city ?? '',
        shippedAt: iso(o.shipped_at),
        deliveredAt: iso(o.delivered_at),
        // promise placed + ETA_DAYS, but never a date in the past for a parcel still on its way (late → tomorrow)
        eta: ['DELIVERED', 'CANCELLED', 'PAYMENT_FAILED', 'REFUNDED', 'RETURN_IN_PROGRESS'].includes(o.status) ? null : iso(new Date(Math.max(new Date(o.placed_at).getTime() + ETA_DAYS * 86_400_000, Date.now() + 86_400_000))),
        lines: lines
          .filter((l: any) => l.order_id === o.id)
          .map((l: any) => ({ productId: l.product_id, title: l.title, category: l.category, sellerName: l.seller_name, qty: l.qty, unitPriceMinor: n(l.unit_price_minor) })),
      })),
    });
  }

  async buyAgain(buyerId: string) {
    const rows = await this.db.query(
      `SELECT l.product_id, (array_agg(l.title ORDER BY o.placed_at DESC))[1] AS title, (array_agg(l.category ORDER BY o.placed_at DESC))[1] AS category,
              (array_agg(l.unit_price_minor ORDER BY o.placed_at DESC))[1] AS last_price, max(o.placed_at) AS last_at, count(DISTINCT o.id) AS times
         FROM order_lines l JOIN orders o ON o.id = l.order_id
        WHERE o.buyer_id = $1 AND o.status = 'DELIVERED'
        GROUP BY l.product_id ORDER BY times DESC, last_at DESC LIMIT 12`,
      [buyerId],
    );
    return BuyAgainSchema.parse({
      currency: CURRENCY,
      items: rows.map((r: any) => ({ productId: r.product_id, title: r.title, category: r.category, lastPriceMinor: n(r.last_price), lastOrderedAt: iso(r.last_at), timesOrdered: n(r.times) })),
    });
  }
}
