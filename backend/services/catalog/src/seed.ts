/** Demo data: this service's slice of the shared demo universe → its own database only. `pnpm seed` */
import { CURRENCY, demoWorld, marketplaceWorld, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ObjectStore } from './modules/images/object-store.js';
import { seedImages } from './modules/images/seed-images.js';
import { ENTITIES } from './modules/dashboard/entities/product.entity.js';
import { MARKETPLACE_ENTITIES } from './modules/marketplace/entities.js';

loadServiceEnv();
const ds = serviceDataSource([...ENTITIES, ...MARKETPLACE_ENTITIES]);
await ds.initialize();
await ds.runMigrations();
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
const w = demoWorld();
const m = marketplaceWorld(w);
const sellerName = new Map(m.sellerAccounts.map((a) => [a.sellerId, a.displayName]));

const categories = await replaceRows(q, 'categories', ['id', 'name', 'gated', 'requirement', 'sort'], m.categories.map((c, i) => [c.id, c.name, c.gated, c.requirement, i]));
// eligibility read model (normally fed by user.events) — verified sellers and their approved gated categories
const eligibility = await replaceRows(q, 'seller_eligibility', ['seller_id', 'display_name', 'verified', 'approved_categories'],
  m.sellerAccounts.filter((a) => a.kycStatus === 'VERIFIED').map((a) => [a.sellerId, a.displayName, true,
    m.categoryApprovals.filter((c) => c.sellerId === a.sellerId && c.status === 'APPROVED').map((c) => c.category)]));
const products = await replaceRows(q, 'products', ['id', 'seller_id', 'sku', 'title', 'category', 'price_minor', 'currency', 'status', 'created_at', 'brand', 'description', 'bullets', 'mrp_minor', 'created_by'],
  w.products.map((p) => {
    const c = m.content.get(p.id)!;
    return [p.id, p.sellerId, p.sku, p.title, p.category, p.priceMinor, CURRENCY, p.status, p.createdAt, c.brand, c.description, JSON.stringify(c.bullets), c.mrpMinor, p.sellerId];
  }));
const offers = await replaceRows(q, 'offers', ['id', 'product_id', 'seller_id', 'seller_sku', 'price_minor', 'mrp_minor', 'quantity', 'currency', 'status', 'created_at'],
  m.offers.map((o) => [o.id, o.productId, o.sellerId, o.sellerSku, o.priceMinor, o.mrpMinor, o.quantity, CURRENCY, o.status, o.createdAt]));
const brands = await replaceRows(q, 'brands', ['id', 'name', 'owner_seller_id', 'owner_name', 'restricted', 'trademark_number', 'created_at'],
  m.brands.map((b) => [b.id, b.name, b.ownerSellerId, sellerName.get(b.ownerSellerId), b.restricted, b.trademarkNumber, b.createdAt]));
const resellers = await replaceRows(q, 'brand_resellers', ['brand_id', 'seller_id', 'seller_name', 'authorized_at'], m.resellers.map((r) => [r.brandId, r.sellerId, sellerName.get(r.sellerId), r.authorizedAt]));
const apps = await replaceRows(q, 'brand_applications', ['id', 'seller_id', 'seller_name', 'brand_name', 'trademark_number', 'trademark_status', 'relationship', 'restrict_resellers', 'status', 'checks', 'submitted_at', 'decided_at', 'decided_by', 'note'],
  m.brandApplications.map((a) => [a.id, a.sellerId, sellerName.get(a.sellerId), a.brandName, a.trademarkNumber, a.trademarkStatus, a.relationship, a.restrictResellers, a.status,
    JSON.stringify([
      { check: 'seller_verified', passed: true, detail: 'Seller KYC verified' },
      { check: 'name_available', passed: true, detail: 'Brand name is not registered' },
      { check: 'trademark_registered', passed: a.trademarkStatus === 'REGISTERED', detail: a.trademarkStatus === 'REGISTERED' ? 'Registered trademark' : 'Trademark application pending — brand team verifies on IP India' },
    ]), a.submittedAt, a.decidedAt, a.decidedAt ? 'brand-team (demo)' : null, a.note]));
console.log(`catalog seed: ${categories} categories, ${eligibility} sellers, ${products} products, ${offers} offers, ${brands} brands, ${resellers} resellers, ${apps} brand applications`);
await seedImages(q, new ObjectStore(), w);
await ds.destroy();
