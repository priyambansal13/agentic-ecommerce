/** Demo data: this service's slice of the shared demo universe → its own database only. `pnpm seed` */
import { demoWorld, marketplaceWorld, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/admin.entity.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
const w = demoWorld();
const mw = marketplaceWorld(w);
const category = new Map(w.products.map((p) => [p.id, p.category]));
const mod = await replaceRows(q, 'moderation_items', ['id', 'product_id', 'title', 'seller_id', 'seller_name', 'agent_verdict', 'confidence', 'reasons', 'status', 'decided_by', 'created_at', 'decided_at', 'brand', 'category'],
  w.moderation.map((m) => [m.id, m.productId, m.title, m.sellerId, m.sellerName, m.agentVerdict, m.confidence, JSON.stringify(m.reasons), m.status, m.decidedBy, m.createdAt, m.decidedAt, mw.content.get(m.productId)?.brand ?? null, category.get(m.productId) ?? null]));
const disputes = await replaceRows(q, 'disputes', ['id', 'order_no', 'status', 'opened_at'], w.disputes.map((d) => [d.id, d.orderNo, d.status, d.openedAt]));
const sanctions = await replaceRows(q, 'seller_sanctions', ['seller_id', 'reason'], w.sanctionedSellerIds.map((id) => [id, 'repeated policy violations (demo)']));
console.log(`admin seed: ${mod} moderation_items, ${disputes} disputes, ${sanctions} seller_sanctions`);
await ds.destroy();
