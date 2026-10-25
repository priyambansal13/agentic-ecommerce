/**
 * Marketplace slice of the demo universe (Amazon model): categories (some gated), seller accounts + KYC,
 * category approvals, Brand Registry (brands, authorized resellers, pending applications), product content
 * (brand, description, bullets) and offers — many sellers per product. Deterministic, built on demoWorld().
 * Owners: user (seller accounts, category approvals) · catalog (categories, brands, products, offers).
 */
import { DEMO_BUYER_ID, DEMO_SELLER_ID, demoWorld, prng, uuidFrom, type DemoWorld } from './index.js';

export interface DemoCategory { id: string; name: string; gated: boolean; requirement: string | null }
/** ids match the product categories in demoWorld (CATALOG keys) */
export const DEMO_CATEGORIES: DemoCategory[] = [
  { id: 'outdoor', name: 'Sports & Outdoors', gated: false, requirement: null },
  { id: 'electronics', name: 'Electronics', gated: false, requirement: null },
  { id: 'home', name: 'Home & Kitchen', gated: false, requirement: null },
  { id: 'fashion', name: 'Fashion', gated: false, requirement: null },
  { id: 'grocery', name: 'Grocery & Gourmet Food', gated: true, requirement: 'FSSAI food business licence number' },
  { id: 'beauty', name: 'Beauty & Personal Care', gated: true, requirement: 'Cosmetics manufacturing/import licence (CDSCO)' },
  { id: 'books', name: 'Books', gated: false, requirement: null },
  { id: 'jewellery', name: 'Jewellery', gated: true, requirement: 'BIS hallmarking registration number' },
];

export type KycState = 'DRAFT' | 'SUBMITTED' | 'ACTION_REQUIRED' | 'VERIFIED' | 'REJECTED';
export interface DemoSellerAccount {
  sellerId: string; displayName: string; legalName: string; businessType: 'MANUFACTURER' | 'BRAND_OWNER' | 'DISTRIBUTOR' | 'RETAILER';
  gstin: string; pan: string; address: { line1: string; city: string; state: string; pincode: string };
  contactEmail: string; contactPhone: string; bank: { accountHolder: string; ifsc: string; accountNumber: string };
  kycStatus: KycState; submittedAt: Date | null; decidedAt: Date | null; decisionNote: string | null; createdAt: Date;
}
export interface DemoCategoryApproval { id: string; sellerId: string; category: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; licenseNumber: string; requestedAt: Date; decidedAt: Date | null; note: string | null }
export interface DemoBrand { id: string; name: string; ownerSellerId: string; restricted: boolean; trademarkNumber: string; createdAt: Date }
export interface DemoBrandApplication { id: string; sellerId: string; brandName: string; trademarkNumber: string; trademarkStatus: 'REGISTERED' | 'PENDING'; relationship: 'OWNER' | 'MANUFACTURER' | 'AUTHORIZED_AGENT'; restrictResellers: boolean; status: 'SUBMITTED' | 'APPROVED' | 'REJECTED'; submittedAt: Date; decidedAt: Date | null; note: string | null }
export interface DemoReseller { brandId: string; sellerId: string; authorizedAt: Date }
export interface DemoProductContent { productId: string; brand: string; description: string; bullets: string[]; mrpMinor: number }
export interface DemoOffer { id: string; productId: string; sellerId: string; sellerSku: string; priceMinor: number; mrpMinor: number; quantity: number; status: 'ACTIVE' | 'INACTIVE' | 'PENDING_PRODUCT'; createdAt: Date }

export interface MarketplaceWorld {
  categories: DemoCategory[];
  sellerAccounts: DemoSellerAccount[];
  categoryApprovals: DemoCategoryApproval[];
  brands: DemoBrand[];
  brandApplications: DemoBrandApplication[];
  resellers: DemoReseller[];
  content: Map<string, DemoProductContent>;
  offers: DemoOffer[];
}

// ---------------------------------------------------------------- KYC identifiers (valid formats + GSTIN checksum)
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** GSTIN check character (mod-36, alternating weights 1/2) over the first 14 characters. */
export function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}
const CITY_STATE: Record<string, [state: string, code: string, pin: string]> = {
  Mumbai: ['Maharashtra', '27', '400001'], Pune: ['Maharashtra', '27', '411001'], Bengaluru: ['Karnataka', '29', '560001'],
  Delhi: ['Delhi', '07', '110001'], Hyderabad: ['Telangana', '36', '500001'], Chennai: ['Tamil Nadu', '33', '600001'],
  Kolkata: ['West Bengal', '19', '700001'], Jaipur: ['Rajasthan', '08', '302001'], Kochi: ['Kerala', '32', '682001'], Lucknow: ['Uttar Pradesh', '09', '226001'],
};
const CITIES = Object.keys(CITY_STATE);
const BANKS = ['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK'];

// ---------------------------------------------------------------- brands (owner = seller index)
const BRANDS: { name: string; owner: number; restricted: boolean; resellers: number[] }[] = [
  { name: 'Trailblaze', owner: 0, restricted: true, resellers: [7, 13] },
  { name: 'Nimbus', owner: 3, restricted: true, resellers: [11] },
  { name: 'Pixelon', owner: 5, restricted: false, resellers: [] },
  { name: 'Urban Threads', owner: 2, restricted: true, resellers: [14] },
  { name: 'Masala Box', owner: 4, restricted: false, resellers: [] },
  { name: 'Chai & Co', owner: 8, restricted: true, resellers: [12] },
  { name: 'Lotus Living', owner: 6, restricted: false, resellers: [] },
  { name: 'Zen Home', owner: 10, restricted: false, resellers: [] },
  { name: 'Indigo Weaves', owner: 14, restricted: false, resellers: [] },
  { name: 'Nova Sound', owner: 15, restricted: true, resellers: [5] },
  { name: 'Green Leaf', owner: 16, restricted: false, resellers: [] },
  { name: 'Swift', owner: 18, restricted: false, resellers: [] },
];
const PENDING_BRANDS = [
  { seller: 1, name: 'Kaveri Handloom', tm: '5123456', status: 'REGISTERED', rel: 'OWNER' },
  { seller: 9, name: 'Bright Pages', tm: '6234567', status: 'PENDING', rel: 'OWNER' },
  { seller: 12, name: 'Saffron Spice', tm: '4345678', status: 'REGISTERED', rel: 'MANUFACTURER' },
] as const;
/** brand used for a seller's products when it owns no registered brand in that category (unregistered = open to all) */
const genericBrand = (sellerName: string) => `${sellerName.replace(/['’]s\b/, '').split(/[ &]/)[0]} Essentials`;

const DESC: Record<string, string> = {
  outdoor: 'Built for trails, treks and weekend camps — tested in Indian monsoon and summer conditions.',
  electronics: 'Reliable everyday tech with a 1-year manufacturer warranty and BIS-compliant charging.',
  home: 'Thoughtfully designed for Indian homes, easy to clean and made to last.',
  fashion: 'Comfortable fit and breathable fabrics, made for all-day wear.',
  grocery: 'Sourced from trusted farms and packed fresh in an FSSAI-licensed facility.',
  beauty: 'Dermatologically tested, cruelty-free and made in a CDSCO-licensed facility.',
  books: 'Printed on acid-free paper with a sewn binding that lasts.',
  jewellery: 'BIS-hallmarked where applicable, nickel-free and gift-boxed.',
};
const BULLETS: Record<string, string[]> = {
  outdoor: ['Lightweight and durable', 'Weather-resistant materials', '6-month replacement warranty'],
  electronics: ['1-year warranty', 'Fast charging support', 'Works with Android and iOS'],
  home: ['Easy to clean', 'Premium finish', 'Gift-ready packaging'],
  fashion: ['Breathable fabric', 'Regular fit', 'Machine washable'],
  grocery: ['FSSAI certified', 'No added preservatives', 'Best before 9 months from packing'],
  beauty: ['Dermatologically tested', 'Paraben-free', 'Cruelty-free'],
  books: ['English edition', 'Acid-free paper', 'Ships in protective packaging'],
  jewellery: ['Nickel-free', 'Anti-tarnish finish', 'Comes in a gift box'],
};

let cached: { world: DemoWorld; m: MarketplaceWorld } | undefined;

export function marketplaceWorld(world: DemoWorld = demoWorld()): MarketplaceWorld {
  if (cached?.world === world) return cached.m;
  const r = prng(0x6d6b7470);
  const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  const t = world.now.getTime();
  const DAY = 86_400_000;
  const { sellers, buyers, products } = world;

  // ---- seller accounts: every demo seller VERIFIED; a few buyers applying (never the demo buyer)
  const account = (id: string, displayName: string, i: number, kycStatus: KycState, ageDays: number): DemoSellerAccount => {
    const city = CITIES[i % CITIES.length];
    const [state, code, pin] = CITY_STATE[city];
    const letters = (displayName.toUpperCase().replace(/[^A-Z]/g, '') + 'XYZ').slice(0, 3);
    const pan = `${letters}C${displayName.toUpperCase().replace(/[^A-Z]/g, 'X')[0]}${String(1000 + ((i * 7919) % 9000)).slice(0, 4)}${B36[10 + (i % 26)]}`;
    const first14 = `${code}${pan}1Z`;
    const createdAt = new Date(t - ageDays * DAY);
    const verified = kycStatus === 'VERIFIED';
    return {
      sellerId: id, displayName, legalName: `${displayName.replace(/['’]/g, '')} Private Limited`,
      businessType: (['RETAILER', 'MANUFACTURER', 'BRAND_OWNER', 'DISTRIBUTOR'] as const)[i % 4],
      gstin: first14 + gstinCheckChar(first14), pan,
      address: { line1: `${10 + i} MG Road, Unit ${i + 1}`, city, state, pincode: pin },
      contactEmail: `seller${i}@example.com`, contactPhone: `98${String(10000000 + i * 1234567).slice(0, 8)}`,
      bank: { accountHolder: `${displayName.replace(/['’]/g, '')} Private Limited`, ifsc: `${BANKS[i % BANKS.length]}0${String(100000 + i * 37).slice(0, 6)}`, accountNumber: String(50100000000 + i * 104729) },
      kycStatus,
      submittedAt: kycStatus === 'DRAFT' ? null : new Date(createdAt.getTime() + DAY / 2),
      decidedAt: verified || kycStatus === 'ACTION_REQUIRED' ? new Date(createdAt.getTime() + 2 * DAY) : null,
      decisionNote: kycStatus === 'ACTION_REQUIRED' ? 'Cancelled cheque is unreadable — please re-upload bank proof.' : verified ? 'GST and PAN verified' : null,
      createdAt,
    };
  };
  const sellerAccounts = sellers.map((s, i) => account(s.id, s.name, i, 'VERIFIED', between(220, 400)));
  const applicants = buyers.filter((b) => b.id !== DEMO_BUYER_ID).slice(0, 5);
  applicants.forEach((b, j) => sellerAccounts.push(account(b.id, `${b.name.split(' ')[0]}'s Store`, 20 + j, j === 4 ? 'ACTION_REQUIRED' : 'SUBMITTED', j + 1)));

  // ---- category approvals for gated categories
  const gated = new Set(DEMO_CATEGORIES.filter((c) => c.gated).map((c) => c.id));
  const categoryApprovals: DemoCategoryApproval[] = [];
  const approve = (sellerId: string, category: string, status: DemoCategoryApproval['status'], ageDays: number) =>
    categoryApprovals.push({
      id: uuidFrom(0xca7e0000, categoryApprovals.length), sellerId, category, status,
      licenseNumber: category === 'grocery' ? `1002${String(10000000000 + categoryApprovals.length * 7331).slice(0, 10)}` : category === 'jewellery' ? `HM/C-${5000000 + categoryApprovals.length}` : `MFG/COS/${2024 + (categoryApprovals.length % 2)}/${100 + categoryApprovals.length}`,
      requestedAt: new Date(t - ageDays * DAY), decidedAt: status === 'PENDING' ? null : new Date(t - (ageDays - 1) * DAY), note: status === 'APPROVED' ? 'Licence verified' : null,
    });
  // every seller already selling in a gated category is approved for it
  const sellingIn = new Set(products.map((p) => `${p.sellerId}|${p.category}`));
  for (const key of sellingIn) {
    const [sellerId, category] = key.split('|');
    if (gated.has(category) && sellerId !== DEMO_SELLER_ID) approve(sellerId, category, 'APPROVED', between(100, 300));
  }
  approve(DEMO_SELLER_ID, 'grocery', 'APPROVED', 40);
  approve(DEMO_SELLER_ID, 'beauty', 'PENDING', 1);
  // pending requests from sellers not yet selling there (first candidate that qualifies)
  const pendingFrom = (category: string, candidates: number[]) => candidates.map((i) => sellers[i].id).find((id) => id !== DEMO_SELLER_ID && !sellingIn.has(`${id}|${category}`));
  for (const [category, candidates, age] of [['jewellery', [17, 6, 10, 2], 2], ['beauty', [14, 2, 10, 6], 3]] as const) {
    const id = pendingFrom(category, [...candidates]);
    if (id) approve(id, category, 'PENDING', age);
  }
  const approvedFor = (sellerId: string, category: string) => !gated.has(category) || categoryApprovals.some((a) => a.sellerId === sellerId && a.category === category && a.status === 'APPROVED');

  // ---- Brand Registry
  const brands: DemoBrand[] = BRANDS.map((b, i) => ({ id: uuidFrom(0xb7a0d000, i), name: b.name, ownerSellerId: sellers[b.owner].id, restricted: b.restricted, trademarkNumber: String(4000000 + i * 104723).slice(0, 7), createdAt: new Date(t - between(150, 300) * DAY) }));
  const resellers: DemoReseller[] = BRANDS.flatMap((b, i) => b.resellers.map((s) => ({ brandId: brands[i].id, sellerId: sellers[s].id, authorizedAt: new Date(t - between(20, 120) * DAY) })));
  const brandApplications: DemoBrandApplication[] = [
    ...BRANDS.map((b, i): DemoBrandApplication => ({ id: uuidFrom(0xb7a0a000, i), sellerId: sellers[b.owner].id, brandName: b.name, trademarkNumber: brands[i].trademarkNumber, trademarkStatus: 'REGISTERED', relationship: 'OWNER', restrictResellers: b.restricted, status: 'APPROVED', submittedAt: new Date(brands[i].createdAt.getTime() - 3 * DAY), decidedAt: brands[i].createdAt, note: 'Trademark verified on IP India' })),
    ...PENDING_BRANDS.map((p, j): DemoBrandApplication => ({ id: uuidFrom(0xb7a0a000, 100 + j), sellerId: sellers[p.seller].id, brandName: p.name, trademarkNumber: p.tm, trademarkStatus: p.status, relationship: p.rel, restrictResellers: true, status: 'SUBMITTED', submittedAt: new Date(t - (j + 1) * DAY), decidedAt: null, note: null })),
  ];
  // a registered brand covers its owner's products in the owner's main category
  const mainCategory = new Map<string, string>();
  for (const s of sellers) {
    const counts = new Map<string, number>();
    for (const p of products) if (p.sellerId === s.id) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    mainCategory.set(s.id, [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'outdoor');
  }
  const brandOf = (sellerIdx: number, category: string) =>
    (mainCategory.get(sellers[sellerIdx].id) === category && BRANDS.find((b) => b.owner === sellerIdx)?.name) || genericBrand(sellers[sellerIdx].name);
  const brandByName = new Map(brands.map((b) => [b.name, b]));
  const mayOffer = (sellerId: string, brandName: string) => {
    const b = brandByName.get(brandName);
    if (!b || !b.restricted || b.ownerSellerId === sellerId) return true;
    return resellers.some((x) => x.brandId === b.id && x.sellerId === sellerId);
  };

  // ---- product content + offers (creator offer + 0–3 more sellers on published products)
  const content = new Map<string, DemoProductContent>();
  const offers: DemoOffer[] = [];
  const sellerIdx = new Map(sellers.map((s, i) => [s.id, i]));
  for (const p of products) {
    const si = sellerIdx.get(p.sellerId)!;
    const brand = brandOf(si, p.category);
    const mrpMinor = Math.round((p.priceMinor * 1.25) / 100) * 100;
    content.set(p.id, { productId: p.id, brand, description: `${brand} ${p.title.toLowerCase()}. ${DESC[p.category] ?? ''}`.trim(), bullets: BULLETS[p.category] ?? ['Quality checked'], mrpMinor });
    const creatorStatus = p.status === 'PUBLISHED' ? 'ACTIVE' : p.status === 'PENDING_REVIEW' || p.status === 'DRAFT' ? 'PENDING_PRODUCT' : 'INACTIVE';
    offers.push({ id: uuidFrom(0x0ffe0000, offers.length), productId: p.id, sellerId: p.sellerId, sellerSku: p.sku, priceMinor: p.priceMinor, mrpMinor, quantity: between(5, 120), status: creatorStatus, createdAt: p.createdAt });
    if (p.status !== 'PUBLISHED') continue;
    const extra = r() < 0.45 ? 0 : between(1, 3);
    const taken = new Set([p.sellerId]);
    for (let k = 0, tries = 0; k < extra && tries < 12; tries++) {
      const s = sellers[Math.floor(r() * sellers.length)];
      if (taken.has(s.id) || !mayOffer(s.id, brand) || !approvedFor(s.id, p.category)) continue;
      taken.add(s.id);
      k++;
      const price = Math.min(mrpMinor, Math.round((p.priceMinor * (0.92 + r() * 0.16)) / 100) * 100 - 1);
      offers.push({ id: uuidFrom(0x0ffe0000, offers.length), productId: p.id, sellerId: s.id, sellerSku: `${s.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-R${String(offers.length).padStart(4, '0')}`, priceMinor: price, mrpMinor, quantity: between(0, 60), status: 'ACTIVE', createdAt: new Date(p.createdAt.getTime() + between(1, 60) * DAY) });
    }
  }
  const m: MarketplaceWorld = { categories: DEMO_CATEGORIES, sellerAccounts, categoryApprovals, brands, brandApplications, resellers, content, offers };
  cached = { world, m };
  return m;
}
