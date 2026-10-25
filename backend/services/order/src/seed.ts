/** Demo data: this service's slice of the shared demo universe → its own database only. `pnpm seed` */
import { CURRENCY, demoWorld, marketplaceWorld, replaceRows } from '@ac/demo-data';
import { createHash } from 'node:crypto';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/order.entity.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
const w = demoWorld();

function stableUuid(key: string) {
  const h = createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

await q('TRUNCATE TABLE seller_orders, order_events, cart_items, guest_cart_items');
// order lines point at the seller's offer for that product (sku = offer id) where the demo world has one
const offerOf = new Map(marketplaceWorld(w).offers.map((o) => [`${o.productId}:${o.sellerId}`, o.id]));
const buyers = new Map(w.buyers.map((b) => [b.id, b]));
const products = new Map(w.products.map((p) => [p.id, p]));
const sellerNames = new Map(w.sellers.map((s) => [s.id, s.name]));
const orders = await replaceRows(q, 'orders', ['id', 'order_no', 'buyer_id', 'status', 'total_minor', 'currency', 'items', 'placed_at', 'shipped_at', 'delivered_at', 'ship_to_name', 'ship_to_city'],
  w.orders.map((o) => [o.id, o.orderNo, o.buyerId, o.status, o.totalMinor, CURRENCY, o.lines.reduce((s, l) => s + l.qty, 0), o.placedAt, o.shippedAt, o.deliveredAt, buyers.get(o.buyerId)?.name ?? null, buyers.get(o.buyerId)?.city ?? null]));
const lines = await replaceRows(q, 'order_lines', ['order_id', 'product_id', 'offer_id', 'seller_order_id', 'title', 'category', 'seller_id', 'seller_name', 'qty', 'unit_price_minor'],
  w.orders.flatMap((o) => o.lines.map((l) => [o.id, l.productId, offerOf.get(`${l.productId}:${l.sellerId}`) ?? null, stableUuid(`${o.id}:${l.sellerId}`), l.title, products.get(l.productId)?.category ?? 'other', l.sellerId, sellerNames.get(l.sellerId) ?? 'unknown', l.qty, l.unitPriceMinor])));

// one sub-order per seller per order
const sub: unknown[][] = [];
for (const o of w.orders) {
  const bySeller = new Map<string, { items: number; total: number }>();
  for (const l of o.lines) {
    const a = bySeller.get(l.sellerId) ?? { items: 0, total: 0 };
    a.items += l.qty;
    a.total += l.qty * l.unitPriceMinor;
    bySeller.set(l.sellerId, a);
  }
  for (const [sellerId, a] of bySeller) sub.push([stableUuid(`${o.id}:${sellerId}`), o.id, sellerId, sellerNames.get(sellerId) ?? 'Seller', o.status, a.items, a.total, o.placedAt]);
}
const subs = await replaceRows(q, 'seller_orders', ['id', 'order_id', 'seller_id', 'seller_name', 'status', 'items', 'total_minor', 'placed_at'], sub);
console.log(`order seed: ${orders} orders, ${lines} order_lines, ${subs} seller_orders`);
await ds.destroy();
