/** Demo data: this service's slice of the shared demo universe → its own database only. `pnpm seed`
 *  One SKU per catalog offer (sku_id = offer id) with the offer's declared quantity; a few offers are
 *  deliberately low / out of stock so dashboards and "Only N left" have something to show. */
import { demoWorld, marketplaceWorld, prng, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/stock.entity.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const w = demoWorld();
const m = marketplaceWorld(w);
const products = new Map(w.products.map((p) => [p.id, p]));
const r = prng(20261024);
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
await q(`TRUNCATE TABLE reservation_lines, reservations, stock_movements`);
const rows = m.offers.map((o, i) => {
  const p = products.get(o.productId)!;
  const roll = r();
  const onHand = roll < 0.06 ? 0 : roll < 0.14 ? 1 + Math.floor(r() * 4) : o.quantity;
  return [o.id, o.productId, o.sellerId, o.sellerSku, p.title, onHand, 0, 5 + (i % 3) * 5];
});
const count = await replaceRows(q, 'stock', ['sku_id', 'product_id', 'seller_id', 'sku', 'title', 'on_hand', 'reserved', 'low_stock_threshold'], rows);
await q(`INSERT INTO stock_movements (sku_id, delta_on_hand, reason, ref_id) SELECT sku_id, on_hand, 'SEED', 'demo' FROM stock WHERE on_hand > 0`);
console.log(`inventory seed: ${count} SKUs (one per offer), ${rows.filter((x) => x[5] === 0).length} out of stock`);
await ds.destroy();
