/**
 * Demo data → this service's read-model tables only (own database). In production the same tables are
 * built by consumers of order/payment/returns events; the seed just pre-computes them. `pnpm seed`
 */
import { demoWorld, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/analytics.entity.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
const w = demoWorld();
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const since30 = w.now.getTime() - 30 * 86_400_000;

const daily = new Map<string, { orders: number; units: number; gross: number; refunds: number }>();
const products = new Map<string, { sellerId: string; productId: string; title: string; units: number; gross: number }>();
const slot = (sellerId: string, day: string) => {
  const k = `${sellerId}|${day}`;
  if (!daily.has(k)) daily.set(k, { orders: 0, units: 0, gross: 0, refunds: 0 });
  return daily.get(k)!;
};
for (const o of w.orders) {
  if (o.status === 'CANCELLED' || o.status === 'PENDING_PAYMENT') continue;
  const sellersInOrder = new Set<string>();
  for (const l of o.lines) {
    const d = slot(l.sellerId, dayOf(o.placedAt));
    d.units += l.qty;
    d.gross += l.qty * l.unitPriceMinor;
    sellersInOrder.add(l.sellerId);
    if (o.placedAt.getTime() >= since30) {
      const pk = `${l.sellerId}|${l.productId}`;
      const p = products.get(pk) ?? { sellerId: l.sellerId, productId: l.productId, title: l.title, units: 0, gross: 0 };
      p.units += l.qty;
      p.gross += l.qty * l.unitPriceMinor;
      products.set(pk, p);
    }
  }
  for (const s of sellersInOrder) slot(s, dayOf(o.placedAt)).orders += 1;
}
for (const c of w.refundCases) if (c.status === 'REFUNDED' && c.resolvedAt) slot(c.sellerId, dayOf(c.resolvedAt)).refunds += c.approvedMinor ?? 0;

const d = await replaceRows(q, 'daily_sales', ['seller_id', 'day', 'orders', 'units', 'gross_minor', 'refunds_minor'],
  [...daily].map(([k, v]) => [...k.split('|'), v.orders, v.units, v.gross, v.refunds]));
const p = await replaceRows(q, 'product_sales', ['seller_id', 'product_id', 'title', 'units', 'gross_minor'],
  [...products.values()].map((v) => [v.sellerId, v.productId, v.title, v.units, v.gross]));
const po = await replaceRows(q, 'seller_payouts', ['payout_id', 'seller_id', 'amount_minor', 'status', 'scheduled_on', 'paid_at'],
  w.payouts.map((x) => [x.id, x.sellerId, x.amountMinor, x.status, dayOf(x.scheduledOn), x.paidAt]));
console.log(`seller-analytics seed: ${d} daily_sales, ${p} product_sales, ${po} seller_payouts`);
await ds.destroy();
