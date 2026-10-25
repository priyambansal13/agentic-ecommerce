/**
 * Deterministic demo universe for local/staging dashboards. The SAME world is generated in every service
 * (fixed PRNG seed), and each service's seed script writes only its own slice into its own database — so
 * data is consistent across services without any cross-database access.
 *
 * DEMO_BUYER_ID / DEMO_SELLER_ID are the Keycloak user ids of `buyer` / `seller` in the customers realm
 * (platform/infra/keycloak/realm-customers.json), so logging in as them shows "their" data.
 */

export const DEMO_BUYER_ID = '0b0b0b0b-0000-4000-8000-000000000001';
export const DEMO_SELLER_ID = '05e11e40-0000-4000-8000-000000000001';
export const CURRENCY = 'INR';

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURN_IN_PROGRESS' | 'REFUNDED';
export type RefundStatus = 'GATHERING_EVIDENCE' | 'AWAITING_BUYER' | 'AUTO_APPROVED' | 'PENDING_HUMAN' | 'APPROVED' | 'REJECTED' | 'REFUND_PENDING' | 'REFUNDED';

export interface Seller { id: string; name: string; tier: 'NEW' | 'STANDARD' | 'TRUSTED' }
export interface Buyer { id: string; name: string; city: string }
export interface Product { id: string; sellerId: string; sku: string; title: string; /** base product type (CATALOG item) — keys images.json */ item: string; category: string; priceMinor: number; status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED'; createdAt: Date }
export interface OrderLine { productId: string; sellerId: string; title: string; qty: number; unitPriceMinor: number }
export interface Order { id: string; orderNo: string; buyerId: string; placedAt: Date; status: OrderStatus; lines: OrderLine[]; totalMinor: number; shippedAt: Date | null; deliveredAt: Date | null }
export interface Payment { id: string; orderId: string; amountMinor: number; status: 'SUCCEEDED' | 'FAILED'; capturedAt: Date }
export interface RefundCase { id: string; orderId: string; orderNo: string; buyerId: string; sellerId: string; reason: string; status: RefundStatus; requestedMinor: number; proposedMinor: number | null; approvedMinor: number | null; riskScore: number; requiredRole: 'support' | 'finance' | null; agentRationale: string | null; decidedBy: 'agent' | 'human' | null; openedAt: Date; resolvedAt: Date | null }
export interface Payout { id: string; sellerId: string; amountMinor: number; status: 'PENDING' | 'PAID'; scheduledOn: Date; paidAt: Date | null }
export interface Stock { skuId: string; /** catalog product the SKU belongs to */ productId: string; sellerId: string; sku: string; title: string; onHand: number; reserved: number; threshold: number }
export interface FraudAlert { id: string; subjectType: 'ORDER' | 'REFUND' | 'SIGNUP'; subject: string; score: number; decision: 'ALLOW' | 'REVIEW' | 'BLOCK'; status: 'OPEN' | 'INVESTIGATING' | 'CONFIRMED_FRAUD' | 'FALSE_POSITIVE'; rules: string[]; raisedAt: Date }
export interface ModerationItem { id: string; productId: string; title: string; sellerId: string; sellerName: string; agentVerdict: 'APPROVE' | 'NEEDS_REVIEW' | 'REJECT'; confidence: number; reasons: string[]; status: 'PENDING' | 'APPROVED' | 'REJECTED'; decidedBy: 'agent' | 'human' | null; createdAt: Date; decidedAt: Date | null }
export interface Dispute { id: string; orderNo: string; status: 'OPEN' | 'AWAITING_SELLER' | 'RESOLVED'; openedAt: Date }

export interface DemoWorld {
  now: Date;
  sellers: Seller[];
  buyers: Buyer[];
  products: Product[];
  orders: Order[];
  payments: Payment[];
  refundCases: RefundCase[];
  payouts: Payout[];
  stock: Stock[];
  fraudAlerts: FraudAlert[];
  moderation: ModerationItem[];
  disputes: Dispute[];
  sanctionedSellerIds: string[];
}

// ---------------------------------------------------------------- deterministic helpers
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** stable uuid (v4 layout) from a namespace + counter, so re-seeding produces identical ids */
export function uuidFrom(ns: number, n: number) {
  const hex = (ns.toString(16).padStart(8, '0') + n.toString(16).padStart(24, '0')).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const DAY = 86_400_000;
const HOUR = 3_600_000;

const SELLER_NAMES = ["Sam's Outdoor Store", 'Kaveri Crafts', 'Urban Threads', 'Nimbus Electronics', 'Masala Box', 'Pixel Gadgets', 'Lotus Home', 'Trailhead Gear', 'Chai & Co', 'Bright Books', 'Zen Living', 'Metro Mobiles', 'Saffron Kitchen', 'Peak Sports', 'Indigo Fabrics', 'Nova Audio', 'Green Leaf Organics', 'Blue Pottery House', 'Swift Cycles', 'Aurora Beauty'];
const FIRST = ['Bea', 'Aarav', 'Diya', 'Kabir', 'Isha', 'Rohan', 'Meera', 'Arjun', 'Zoya', 'Vikram', 'Ananya', 'Dev', 'Tara', 'Kiran', 'Neel', 'Riya', 'Omar', 'Sara', 'Yash', 'Leela'];
const LAST = ['Sharma', 'Iyer', 'Khan', 'Patel', 'Reddy', 'Das', 'Mehta', 'Nair', 'Gupta', 'Singh'];
const CITIES = ['Mumbai', 'Bengaluru', 'Delhi', 'Pune', 'Hyderabad', 'Chennai', 'Kolkata', 'Jaipur', 'Kochi', 'Lucknow'];
export const CATALOG: Record<string, { items: string[]; price: [number, number]; variants?: string[] }> = {
  outdoor: { items: ['Trail running shoes', 'Steel water bottle 1 L', 'Hiking backpack 30 L', 'Trekking poles', 'Camping lantern', 'Rain jacket', 'Sleeping bag', 'Headlamp'], price: [49900, 899900] },
  electronics: { items: ['Noise-cancelling headphones', 'Bluetooth speaker', 'USB-C charger 65 W', 'Smartwatch', 'Wireless mouse', 'Mechanical keyboard', 'Power bank 20000 mAh', 'Earbuds'], price: [79900, 1499900] },
  home: { items: ['Ceramic dinner set', 'Cotton bedsheet', 'Table lamp', 'Wall clock', 'Scented candle set', 'Cushion covers', 'Storage baskets'], price: [29900, 499900] },
  fashion: { items: ['Linen shirt', 'Denim jacket', 'Silk scarf', 'Leather wallet', 'Sneakers', 'Kurta set'], price: [39900, 599900] },
  grocery: { items: ['Masala chai 500 g', 'Organic honey', 'Basmati rice 5 kg', 'Cold-pressed oil', 'Dry fruit box'], price: [19900, 249900] },
  beauty: { items: ['Lipstick', 'Perfume', 'Nail polish', 'Makeup brush set', 'Handmade soap', 'Compact powder'], price: [14900, 249900], variants: ['Rose', 'Classic', 'Travel size', 'Matte', 'Gift set'] },
  books: { items: ['Monsoon Stories — short story collection', 'Everyday cookbook', 'Pop-up picture book', 'Classic comics collection', 'Poems of the Rain — poetry collection', 'World atlas'], price: [19900, 149900], variants: ['Paperback', 'Hardcover', 'Large print', 'Collector’s edition', 'Gift edition'] },
  jewellery: { items: ['Silver earrings', 'Gold-plated necklace', 'Glass bangles', 'Silver ring', 'Pendant necklace', 'Silver anklet'], price: [49900, 1499900], variants: ['Classic', 'Oxidised', 'Rose gold', 'Gift box', 'Daily wear'] },
};
/** Sellers whose main category is not the default rotation over the first five categories (index → category). */
const MAIN_CATEGORY: Record<number, string> = { 1: 'jewellery', 9: 'books', 19: 'beauty' };
const DEFAULT_VARIANTS = ['Blue', 'Black', 'Large', 'Pro', 'Lite'];
const REASONS = ['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NOT_DELIVERED', 'CHANGED_MIND', 'LATE'];
const RULES = ['velocity_orders_1h', 'bin_country_mismatch', 'new_account_high_value', 'disposable_email', 'refund_rate_180d', 'address_reuse', 'device_shared_accounts', 'seller_self_purchase'];
const MOD_REASONS = ['brand keyword in title', 'price far below brand band', 'restricted category', 'medical claim in description', 'duplicate image across sellers', 'low-quality images'];

let cached: DemoWorld | undefined;

/** The demo universe, relative to `now` (default: current time). Same seed → same ids and shape. */
export function demoWorld(now = new Date(), seed = 20261023): DemoWorld {
  if (cached && Math.abs(cached.now.getTime() - now.getTime()) < 60_000) return cached;
  const r = prng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  const t = now.getTime();

  const sellers: Seller[] = SELLER_NAMES.map((name, i) => ({
    id: i === 0 ? DEMO_SELLER_ID : uuidFrom(0x5e11e400, i),
    name,
    tier: i === 0 ? 'TRUSTED' : (['NEW', 'STANDARD', 'STANDARD', 'TRUSTED'] as const)[i % 4],
  }));
  const buyers: Buyer[] = Array.from({ length: 200 }, (_, i) => ({
    id: i === 0 ? DEMO_BUYER_ID : uuidFrom(0xb0b0b000, i),
    name: i === 0 ? 'Bea Dev' : `${pick(FIRST)} ${pick(LAST)}`,
    city: pick(CITIES),
  }));

  const categories = Object.keys(CATALOG);
  const products: Product[] = [];
  sellers.forEach((s, si) => {
    const count = si === 0 ? 24 : between(8, 16);
    const cat = si === 0 ? 'outdoor' : (MAIN_CATEGORY[si] ?? categories[si % 5]);
    for (let k = 0; k < count; k++) {
      const itemCat = k % 5 === 4 && si !== 0 ? pick(categories) : cat;
      const c = CATALOG[itemCat];
      const base = c.items[k % c.items.length];
      const variant = k >= c.items.length ? ` · ${(c.variants ?? DEFAULT_VARIANTS)[k % 5]}` : '';
      const roll = r();
      products.push({
        id: uuidFrom(0x9000d000 + si, k),
        sellerId: s.id,
        sku: `${s.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${String(k + 1).padStart(3, '0')}`,
        title: `${base}${variant}`,
        item: base,
        category: itemCat,
        priceMinor: Math.round(between(c.price[0], c.price[1]) / 100) * 100 - 100,
        status: roll < 0.82 ? 'PUBLISHED' : roll < 0.9 ? 'PENDING_REVIEW' : roll < 0.96 ? 'DRAFT' : 'REJECTED',
        createdAt: new Date(t - between(10, 200) * DAY),
      });
    }
  });
  const live = products.filter((p) => p.status === 'PUBLISHED');

  const orders: Order[] = [];
  for (let i = 0; i < 1500; i++) {
    // mostly the last 60 days (dashboards), ~20% spread over 13 months (order history ranges), a few placed today
    const ageDays = i < 12 ? r() * 0.08 : r() < 0.2 ? 60 + r() * 330 : Math.pow(r(), 1.3) * 60;
    const placedAt = new Date(t - ageDays * DAY - (i < 12 ? 0 : between(0, 23) * HOUR));
    const buyer = i % 25 === 0 ? buyers[0] : pick(buyers);
    const lines: OrderLine[] = [];
    const n = r() < 0.75 ? 1 : between(2, 3);
    // the demo seller gets ~10% of orders so its dashboard is lively
    const forDemoSeller = i < 12 ? i % 2 === 0 : r() < 0.1;
    for (let k = 0; k < n; k++) {
      const p = forDemoSeller ? pick(live.filter((x) => x.sellerId === DEMO_SELLER_ID)) : pick(live);
      const bulk = r() < 0.04; // occasional bulk orders → high-value refunds that need finance (dual control ≥ ₹25,000)
      lines.push({ productId: p.id, sellerId: p.sellerId, title: p.title, qty: bulk ? between(4, 8) : r() < 0.85 ? 1 : 2, unitPriceMinor: p.priceMinor });
    }
    const totalMinor = lines.reduce((s, l) => s + l.qty * l.unitPriceMinor, 0);
    const days = ageDays;
    let status: OrderStatus;
    const roll = r();
    if (roll < 0.03) status = 'CANCELLED';
    else if (days < 0.2) status = r() < 0.5 ? 'PENDING_PAYMENT' : 'PAID';
    else if (days < 1.5) status = 'CONFIRMED';
    else if (days < 4) status = r() < 0.6 ? 'SHIPPED' : 'CONFIRMED';
    else status = 'DELIVERED';
    // most sellers ship within 2 days; ~12% ship late (> 48 h) — feeds the late-shipment rate in Account Health
    const shippedAt = ['SHIPPED', 'DELIVERED'].includes(status) ? new Date(placedAt.getTime() + (r() < 0.12 ? between(50, 96) : between(12, 46)) * HOUR) : null;
    const deliveredAt = status === 'DELIVERED' && shippedAt ? new Date(shippedAt.getTime() + between(24, 72) * HOUR) : null;
    orders.push({ id: uuidFrom(0x0e0e0000, i), orderNo: `ORD-${String(260000 + i)}`, buyerId: buyer.id, placedAt, status, lines, totalMinor, shippedAt, deliveredAt });
  }

  const payments: Payment[] = orders
    .filter((o) => o.status !== 'PENDING_PAYMENT')
    .map((o, i) => ({ id: uuidFrom(0xbabe0000, i), orderId: o.id, amountMinor: o.totalMinor, status: o.status === 'CANCELLED' && r() < 0.5 ? 'FAILED' : 'SUCCEEDED', capturedAt: new Date(o.placedAt.getTime() + 2 * 60_000) }));

  const refundCases: RefundCase[] = [];
  orders
    .filter((o) => o.status === 'DELIVERED')
    .forEach((o) => {
      if (r() > (o.buyerId === DEMO_BUYER_ID ? 0.35 : o.totalMinor > 2500000 ? 0.5 : 0.07)) return;
      const openedAt = new Date((o.deliveredAt ?? o.placedAt).getTime() + between(4, 96) * HOUR);
      if (openedAt.getTime() > t) return;
      const requested = r() < 0.7 ? o.totalMinor : Math.round(o.totalMinor / 2);
      const risk = Math.round(Math.pow(r(), 2) * 100) / 100;
      const big = requested > 2500000;
      const ageH = (t - openedAt.getTime()) / HOUR;
      let status: RefundStatus;
      let requiredRole: RefundCase['requiredRole'] = null;
      let decidedBy: RefundCase['decidedBy'] = null;
      if (ageH < 6) status = r() < 0.5 ? 'GATHERING_EVIDENCE' : 'AWAITING_BUYER';
      else if (requested <= 200000 && risk < 0.3) {
        status = ageH < 30 ? 'REFUND_PENDING' : 'REFUNDED'; // inside the auto-approve envelope: the agent decided
        decidedBy = 'agent';
      }
      else if (ageH < 72 || (big && ageH < 240)) {
        status = 'PENDING_HUMAN';
        requiredRole = big ? 'finance' : 'support';
      } else {
        status = r() < 0.8 ? 'REFUNDED' : 'REJECTED';
        decidedBy = 'human';
      }
      if (status === 'REFUND_PENDING' && r() < 0.3) status = 'AUTO_APPROVED';
      const proposed = ['GATHERING_EVIDENCE', 'AWAITING_BUYER'].includes(status) ? null : requested;
      const reason = pick(REASONS);
      refundCases.push({
        id: uuidFrom(0x0ca5e000, refundCases.length),
        orderId: o.id,
        orderNo: o.orderNo,
        buyerId: o.buyerId,
        sellerId: o.lines[0].sellerId,
        reason,
        status,
        requestedMinor: requested,
        proposedMinor: proposed,
        approvedMinor: ['REFUNDED', 'REFUND_PENDING', 'AUTO_APPROVED', 'APPROVED'].includes(status) ? requested : null,
        riskScore: risk,
        requiredRole,
        decidedBy,
        agentRationale: proposed === null ? null : `${reason.replaceAll('_', ' ').toLowerCase()} — evidence ${risk < 0.3 ? 'consistent' : 'needs a human look'}; policy v1 allows refund; risk ${risk.toFixed(2)}`,
        openedAt,
        resolvedAt: ['REFUNDED', 'REJECTED'].includes(status) ? new Date(openedAt.getTime() + between(1, 60) * HOUR) : null,
      });
    });

  const payouts: Payout[] = [];
  sellers.forEach((s) => {
    for (let w = 8; w >= 0; w--) {
      const scheduledOn = new Date(t - w * 7 * DAY + 2 * DAY);
      scheduledOn.setUTCHours(0, 0, 0, 0);
      const pending = w === 0;
      payouts.push({ id: uuidFrom(0xa1ed0000 + payouts.length, 0), sellerId: s.id, amountMinor: between(200000, s.id === DEMO_SELLER_ID ? 3500000 : 1800000), status: pending ? 'PENDING' : 'PAID', scheduledOn, paidAt: pending ? null : scheduledOn });
    }
  });

  const stock: Stock[] = products
    .filter((p) => p.status === 'PUBLISHED')
    .map((p) => {
      const threshold = between(3, 10);
      const onHand = r() < 0.12 ? between(0, threshold) : between(threshold + 1, 120);
      return { skuId: p.id, productId: p.id, sellerId: p.sellerId, sku: p.sku, title: p.title, onHand, reserved: Math.min(onHand, between(0, 3)), threshold };
    });

  const fraudAlerts: FraudAlert[] = Array.from({ length: 70 }, (_, i) => {
    const score = Math.round((0.35 + r() * 0.65) * 100) / 100;
    const ageH = Math.pow(r(), 1.5) * 30 * 24;
    const status = ageH < 24 ? 'OPEN' : ageH < 72 ? (r() < 0.5 ? 'OPEN' : 'INVESTIGATING') : r() < 0.35 ? 'CONFIRMED_FRAUD' : 'FALSE_POSITIVE';
    const nRules = between(1, 3);
    const rules = Array.from(new Set(Array.from({ length: nRules }, () => pick(RULES))));
    const o = pick(orders);
    const subjectType = r() < 0.75 ? 'ORDER' : r() < 0.5 ? 'REFUND' : 'SIGNUP';
    const subject = subjectType === 'SIGNUP' ? `account ${pick(buyers).name}` : o.orderNo;
    return { id: uuidFrom(0xf4a40000, i), subjectType, subject, score, decision: score > 0.85 ? 'BLOCK' : score > 0.6 ? 'REVIEW' : 'ALLOW', status, rules, raisedAt: new Date(t - ageH * HOUR) };
  });

  const moderation: ModerationItem[] = products
    .filter((p) => p.status !== 'DRAFT')
    .slice(0, 90)
    .map((p, i) => {
      const s = sellers.find((x) => x.id === p.sellerId)!;
      const roll = r();
      const verdict = roll < 0.7 ? 'APPROVE' : roll < 0.9 ? 'NEEDS_REVIEW' : 'REJECT';
      const pending = p.status === 'PENDING_REVIEW' || (verdict !== 'APPROVE' && r() < 0.3);
      const createdAt = new Date(t - Math.pow(r(), 1.4) * 9 * DAY);
      const decidedBy = pending ? null : verdict === 'APPROVE' && s.tier !== 'NEW' ? 'agent' : 'human';
      return {
        id: uuidFrom(0x40de0000, i),
        productId: p.id,
        title: p.title,
        sellerId: s.id,
        sellerName: s.name,
        agentVerdict: verdict,
        confidence: Math.round((verdict === 'APPROVE' ? 0.8 + r() * 0.2 : 0.4 + r() * 0.45) * 100) / 100,
        reasons: verdict === 'APPROVE' ? [] : [pick(MOD_REASONS)],
        status: pending ? 'PENDING' : verdict === 'REJECT' ? 'REJECTED' : 'APPROVED',
        decidedBy,
        createdAt,
        decidedAt: pending ? null : new Date(createdAt.getTime() + between(1, 30) * HOUR),
      };
    });

  const disputes: Dispute[] = refundCases
    .filter((c) => c.status === 'REJECTED')
    .slice(0, 14)
    .map((c, i) => ({ id: uuidFrom(0xd15e0000, i), orderNo: c.orderNo, status: i < 5 ? 'OPEN' : i < 8 ? 'AWAITING_SELLER' : 'RESOLVED', openedAt: new Date((c.resolvedAt ?? c.openedAt).getTime() + 6 * HOUR) }));

  cached = { now, sellers, buyers, products, orders, payments, refundCases, payouts, stock, fraudAlerts, moderation, disputes, sanctionedSellerIds: [sellers[7].id, sellers[13].id] };
  return cached;
}

/** Seed helper for services: TRUNCATE the given tables then insert rows in batches (raw SQL, own DB only). */
export async function replaceRows(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  table: string,
  columns: string[],
  rows: unknown[][],
  batch = 500,
) {
  await query(`TRUNCATE TABLE ${table} CASCADE`);
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const params: unknown[] = [];
    const values = chunk.map((row) => `(${row.map((v) => (params.push(v), `$${params.length}`)).join(', ')})`).join(', ');
    await query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`, params);
  }
  return rows.length;
}
export * from './marketplace.js';
export * from './images.js';
