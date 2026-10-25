import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CategoriesSchema,
  MyListingsSchema,
  type OfferInput,
  type ProductInput,
  ProductDetailSchema,
  ProductSearchSchema,
  SellerEligibilitySchema,
  TOPICS,
} from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { eligibilityOf } from './eligibility.js';
import { toProductImage } from '../images/images.service.js';

const CURRENCY = 'INR';
const PAGE_SIZE = 24;
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: Date | string) => new Date(v).toISOString();

type RejectionCode = 'SELLER_NOT_VERIFIED' | 'CATEGORY_NOT_APPROVED' | 'BRAND_RESTRICTED' | 'BRAND_NOT_OWNED' | 'PRODUCT_NOT_PUBLISHED' | 'DUPLICATE_OFFER' | 'PRICE_ABOVE_MRP';
/** 422 with a ListingRejection body */
const reject = (code: RejectionCode, message: string) => new UnprocessableEntityException({ code, message });

@Injectable()
export class ListingsService {
  constructor(private readonly db: DataSource, private readonly outbox: OutboxService) {}

  async categories() {
    const rows = await this.db.query(
      `SELECT c.id, c.name, c.gated, c.requirement, (ci.image_id IS NOT NULL) AS "hasImage" FROM categories c LEFT JOIN category_images ci ON ci.category_id = c.id ORDER BY c.sort, c.name`,
    );
    return CategoriesSchema.parse({ categories: rows });
  }

  async eligibility(sellerId: string) {
    const e = await eligibilityOf(this.db, sellerId);
    return SellerEligibilitySchema.parse({ verified: e.verified, approvedCategories: e.approvedCategories, ownedBrands: e.ownedBrands.map((b) => b.name), authorizedBrands: e.authorizedBrands.map((b) => b.name) });
  }

  /** Shared listing rules for a seller in a category (verification + gating). */
  private async checkSeller(tx: EntityManager, sellerId: string, category: string) {
    const e = await eligibilityOf(tx, sellerId);
    if (!e.verified) throw reject('SELLER_NOT_VERIFIED', 'Complete seller verification (KYC) before listing');
    const [cat] = await tx.query(`SELECT name, gated FROM categories WHERE id = $1`, [category]);
    if (!cat) throw new BadRequestException(`Unknown category ${category}`);
    if (cat.gated && !e.approvedCategories.includes(category)) throw reject('CATEGORY_NOT_APPROVED', `${cat.name} is a gated category — request approval in Seller Central first`);
    return e;
  }

  /** POST /products — a NEW catalog product (goes to moderation) plus the creator's first offer. */
  async createProduct(sellerId: string, p: ProductInput) {
    if (p.offer.mrpMinor && p.offer.priceMinor > p.offer.mrpMinor) throw reject('PRICE_ABOVE_MRP', 'Price cannot exceed the MRP');
    const productId = randomUUID();
    const offerId = randomUUID();
    await this.db.transaction(async (tx) => {
      const e = await this.checkSeller(tx, sellerId, p.category);
      const [brand] = await tx.query(`SELECT name, owner_seller_id FROM brands WHERE lower(name) = lower($1)`, [p.brand]);
      if (brand && brand.owner_seller_id !== sellerId) {
        throw reject('BRAND_NOT_OWNED', `${brand.name} is a registered brand — only its owner can create new products. Sell an existing ${brand.name} product instead.`);
      }
      const brandName = brand?.name ?? p.brand;
      await tx.query(
        `INSERT INTO products (id, seller_id, sku, title, category, price_minor, currency, status, brand, description, bullets, mrp_minor, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_REVIEW', $8, $9, $10, $11, $2)`,
        [productId, sellerId, p.offer.sellerSku, p.title, p.category, p.offer.priceMinor, CURRENCY, brandName, p.description, JSON.stringify(p.bullets), p.offer.mrpMinor ?? null],
      );
      await tx.query(
        `INSERT INTO offers (id, product_id, seller_id, seller_sku, price_minor, mrp_minor, quantity, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING_PRODUCT')`,
        [offerId, productId, sellerId, p.offer.sellerSku, p.offer.priceMinor, p.offer.mrpMinor ?? null, p.offer.quantity, CURRENCY],
      );
      await this.outbox.enqueue(tx, {
        topic: TOPICS.catalog,
        type: 'catalog.product_submitted.v1',
        aggregateId: productId,
        data: { productId, sellerId, sellerName: e.displayName, title: p.title, brand: brandName, category: p.category, description: p.description, bullets: p.bullets },
      });
      await this.outbox.enqueue(tx, {
        topic: TOPICS.catalog,
        type: 'catalog.offer_created.v1',
        aggregateId: productId,
        data: { offerId, productId, sellerId, sellerSku: p.offer.sellerSku, title: p.title, quantity: p.offer.quantity },
      });
    });
    return { productId, offerId, status: 'PENDING_REVIEW' as const };
  }

  /** POST /offers — sell an EXISTING published product. */
  async createOffer(sellerId: string, o: OfferInput) {
    const offerId = randomUUID();
    await this.db.transaction(async (tx) => {
      const [p] = await tx.query(`SELECT id, title, category, brand, status, mrp_minor FROM products WHERE id = $1`, [o.productId]);
      if (!p || p.status !== 'PUBLISHED') throw reject('PRODUCT_NOT_PUBLISHED', 'Offers can only be added to published products');
      await this.checkSeller(tx, sellerId, p.category);
      const [brand] = await tx.query(`SELECT id, name, owner_seller_id, restricted FROM brands WHERE lower(name) = lower($1)`, [p.brand]);
      if (brand?.restricted && brand.owner_seller_id !== sellerId) {
        const [auth] = await tx.query(`SELECT 1 FROM brand_resellers WHERE brand_id = $1 AND seller_id = $2`, [brand.id, sellerId]);
        if (!auth) throw reject('BRAND_RESTRICTED', `${brand.name} restricts resellers — ask the brand owner to authorize you`);
      }
      const mrp = o.mrpMinor ?? (p.mrp_minor ? n(p.mrp_minor) : null);
      if (mrp && o.priceMinor > mrp) throw reject('PRICE_ABOVE_MRP', `Price cannot exceed the MRP (${mrp / 100})`);
      const [dup] = await tx.query(`SELECT 1 FROM offers WHERE product_id = $1 AND seller_id = $2`, [o.productId, sellerId]);
      if (dup) throw reject('DUPLICATE_OFFER', 'You already have an offer on this product — edit it instead');
      await tx.query(
        `INSERT INTO offers (id, product_id, seller_id, seller_sku, price_minor, mrp_minor, quantity, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')`,
        [offerId, o.productId, sellerId, o.sellerSku, o.priceMinor, mrp, o.quantity, CURRENCY],
      );
      await this.outbox.enqueue(tx, {
        topic: TOPICS.catalog,
        type: 'catalog.offer_created.v1',
        aggregateId: o.productId,
        data: { offerId, productId: o.productId, sellerId, sellerSku: o.sellerSku, title: p.title, quantity: o.quantity },
      });
    });
    return { offerId, productId: o.productId, status: 'ACTIVE' as const };
  }

  /** GET /products?q=&category=&page= — published products with at least one active offer. */
  async search(q: string | undefined, category: string | undefined, page: number) {
    const where = [`p.status = 'PUBLISHED'`];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      where.push(`(p.title ILIKE $${params.length} OR p.brand ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }
    const base = `FROM products p JOIN offers o ON o.product_id = p.id AND o.status = 'ACTIVE' WHERE ${where.join(' AND ')}`;
    const [t] = await this.db.query(`SELECT count(DISTINCT p.id) AS c ${base}`, params);
    const rows = await this.db.query(
      `SELECT p.id, p.title, p.brand, p.category, p.mrp_minor, min(o.price_minor) AS min_price, count(o.id) AS offers,
              (SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.position LIMIT 1) AS image_id
         ${base} GROUP BY p.id ORDER BY count(o.id) DESC, p.title LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params,
    );
    return ProductSearchSchema.parse({
      currency: CURRENCY, total: n(t.c), page, pageSize: PAGE_SIZE,
      items: rows.map((r: any) => ({ productId: r.id, title: r.title, brand: r.brand, category: r.category, minPriceMinor: n(r.min_price), mrpMinor: r.mrp_minor ? n(r.mrp_minor) : null, offerCount: n(r.offers), imageId: r.image_id ?? null })),
    });
  }

  /** GET /products/:id — one product page, all active offers (cheapest first). */
  async detail(id: string) {
    const [p] = await this.db.query(`SELECT * FROM products WHERE id = $1 AND status = 'PUBLISHED'`, [id]);
    if (!p) throw new NotFoundException('Product not found');
    const [b] = await this.db.query(`SELECT restricted, owner_name FROM brands WHERE lower(name) = lower($1)`, [p.brand]);
    const offers = await this.db.query(
      `SELECT o.id, o.seller_id, coalesce(e.display_name, 'Seller') AS seller_name, o.price_minor, o.mrp_minor
         FROM offers o LEFT JOIN seller_eligibility e USING (seller_id)
        WHERE o.product_id = $1 AND o.status = 'ACTIVE' ORDER BY o.price_minor, o.created_at`,
      [id],
    );
    const images = await this.db.query(`SELECT id, position, alt, width, height, attribution FROM product_images WHERE product_id = $1 ORDER BY position`, [id]);
    return ProductDetailSchema.parse({
      currency: CURRENCY, productId: p.id, title: p.title, images: images.map(toProductImage),
      brand: { name: p.brand, restricted: !!b?.restricted, ownerName: b?.owner_name ?? null },
      category: p.category, description: p.description, bullets: p.bullets, status: p.status,
      offers: offers.map((o: any) => ({ offerId: o.id, sellerId: o.seller_id, sellerName: o.seller_name, priceMinor: n(o.price_minor), mrpMinor: o.mrp_minor ? n(o.mrp_minor) : null })),
    });
  }

  /** GET /sellers/me/listings — my offers + products I created (with moderation outcome). */
  async mine(sellerId: string) {
    const offers = await this.db.query(
      `SELECT o.id, o.product_id, p.title, p.brand, p.category, o.seller_sku, o.price_minor, o.status, o.created_at
         FROM offers o JOIN products p ON p.id = o.product_id WHERE o.seller_id = $1 ORDER BY o.created_at DESC LIMIT 200`,
      [sellerId],
    );
    const products = await this.db.query(
      `SELECT id, title, brand, category, status, moderation_note, created_at FROM products
        WHERE coalesce(created_by, seller_id) = $1 AND status <> 'DRAFT' ORDER BY created_at DESC LIMIT 200`,
      [sellerId],
    );
    return MyListingsSchema.parse({
      currency: CURRENCY,
      offers: offers.map((o: any) => ({ offerId: o.id, productId: o.product_id, title: o.title, brand: o.brand, category: o.category, sellerSku: o.seller_sku, priceMinor: n(o.price_minor), status: o.status, createdAt: iso(o.created_at) })),
      products: products.map((p: any) => ({ productId: p.id, title: p.title, brand: p.brand, category: p.category, status: p.status, moderationNote: p.moderation_note, createdAt: iso(p.created_at) })),
    });
  }
}
