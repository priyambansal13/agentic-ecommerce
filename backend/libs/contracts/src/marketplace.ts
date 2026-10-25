/**
 * Marketplace model (Amazon-style): seller accounts & KYC, Brand Registry, gated categories, shared catalog with
 * offers, moderation decisions, and the versioned fee schedule. Contracts 0.4.0 — all additive.
 * Owning service in brackets; endpoints are under /api/<service>/v1/…
 */
import { z } from 'zod';

const Minor = z.int();
const IsoDate = z.iso.datetime();
const Note = z.string().trim().max(500);

export const CheckSchema = z.object({ check: z.string(), passed: z.boolean(), detail: z.string() });
export type Check = z.infer<typeof CheckSchema>;
export const DecisionInputSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
  note: Note.default(''),
  /** optimistic concurrency: the version the reviewer saw */
  version: z.int().min(1),
});
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

// ================================================================ seller accounts & KYC [user]
export const BusinessType = z.enum(['MANUFACTURER', 'BRAND_OWNER', 'DISTRIBUTOR', 'RETAILER']);
export const KycStatus = z.enum(['DRAFT', 'SUBMITTED', 'ACTION_REQUIRED', 'VERIFIED', 'REJECTED']);
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** PUT /sellers/me (save draft) · POST /sellers/me/submit — role buyer (anyone signed in can apply) */
export const SellerApplicationInputSchema = z.object({
  legalName: z.string().trim().min(3).max(120),
  displayName: z.string().trim().min(2).max(60),
  businessType: BusinessType,
  gstin: z.string().trim().toUpperCase().regex(GSTIN_RE, 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5'),
  pan: z.string().trim().toUpperCase().regex(PAN_RE, 'PAN must look like ABCDE1234F'),
  address: z.object({ line1: z.string().trim().min(3).max(160), city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60), pincode: z.string().regex(/^\d{6}$/) }),
  contactEmail: z.email(),
  contactPhone: z.string().regex(/^[6-9]\d{9}$/, '10-digit Indian mobile number'),
  bank: z.object({ accountHolder: z.string().trim().min(3).max(120), ifsc: z.string().trim().toUpperCase().regex(IFSC_RE, 'IFSC looks like HDFC0001234'), accountNumber: z.string().regex(/^\d{9,18}$/) }),
});
export type SellerApplicationInput = z.infer<typeof SellerApplicationInputSchema>;

/** GET /sellers/me — the caller's seller account (404 when none). Sensitive values are masked. */
export const SellerAccountSchema = z.object({
  sellerId: z.uuid(),
  displayName: z.string(),
  legalName: z.string(),
  businessType: BusinessType,
  gstin: z.string(),
  panMasked: z.string(),
  address: z.object({ line1: z.string(), city: z.string(), state: z.string(), pincode: z.string() }),
  contactEmail: z.string(),
  bank: z.object({ accountHolder: z.string(), ifsc: z.string(), accountLast4: z.string() }),
  kycStatus: KycStatus,
  checks: z.array(CheckSchema),
  submittedAt: IsoDate.nullable(),
  decidedAt: IsoDate.nullable(),
  decisionNote: z.string().nullable(),
  version: z.int(),
});
export type SellerAccount = z.infer<typeof SellerAccountSchema>;

/** GET /kyc/queue — roles compliance, admin · POST /kyc/:sellerId/decision (DecisionInput) */
export const KycQueueSchema = z.object({
  kpis: z.object({ submitted: z.int(), actionRequired: z.int(), verified30d: z.int(), rejected30d: z.int() }),
  items: z.array(SellerAccountSchema),
});

export const CategoryApprovalStatus = z.enum(['NOT_REQUIRED', 'NOT_REQUESTED', 'PENDING', 'APPROVED', 'REJECTED']);
/** GET /sellers/me/categories — role seller · POST /sellers/me/categories/:category { licenseNumber } */
export const SellerCategoriesSchema = z.object({
  categories: z.array(z.object({ category: z.string(), name: z.string(), gated: z.boolean(), requirement: z.string().nullable(), status: CategoryApprovalStatus, licenseNumber: z.string().nullable(), note: z.string().nullable() })),
});
export const CategoryRequestInputSchema = z.object({ licenseNumber: z.string().trim().min(5).max(40) });
/** GET /category-approvals/queue — roles category-team, admin · POST /category-approvals/:id/decision */
export const CategoryApprovalQueueSchema = z.object({
  items: z.array(z.object({ approvalId: z.uuid(), sellerId: z.uuid(), sellerName: z.string(), category: z.string(), requirement: z.string(), licenseNumber: z.string(), requestedAt: IsoDate, version: z.int() })),
});

// ================================================================ brands, catalog, offers [catalog]
export const BrandSchema = z.object({ brandId: z.uuid(), name: z.string(), ownerSellerId: z.uuid(), ownerName: z.string(), restricted: z.boolean() });
export type Brand = z.infer<typeof BrandSchema>;

/** POST /brands/applications — role seller (verified) */
export const BrandApplicationInputSchema = z.object({
  brandName: z.string().trim().min(2).max(60),
  trademarkNumber: z.string().trim().regex(/^\d{6,8}$/, 'Indian trademark application number (6–8 digits)'),
  trademarkStatus: z.enum(['REGISTERED', 'PENDING']),
  relationship: z.enum(['OWNER', 'MANUFACTURER', 'AUTHORIZED_AGENT']),
  evidenceUrl: z.url().optional(),
  restrictResellers: z.boolean().default(true),
});
export type BrandApplicationInput = z.infer<typeof BrandApplicationInputSchema>;
export const BrandApplicationSchema = BrandApplicationInputSchema.extend({
  applicationId: z.uuid(),
  sellerId: z.uuid(),
  sellerName: z.string(),
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']),
  checks: z.array(CheckSchema),
  submittedAt: IsoDate,
  decidedAt: IsoDate.nullable(),
  note: z.string().nullable(),
  version: z.int(),
});
export type BrandApplication = z.infer<typeof BrandApplicationSchema>;

/** GET /brands/mine — role seller: brands I own (+ authorized resellers) and my applications */
export const MyBrandsSchema = z.object({
  owned: z.array(BrandSchema.extend({ resellers: z.array(z.object({ sellerId: z.uuid(), sellerName: z.string(), authorizedAt: IsoDate })) })),
  authorizedFor: z.array(BrandSchema),
  applications: z.array(BrandApplicationSchema),
});
/** PUT /brands/:brandId/resellers/:sellerId · DELETE … — brand owner only */

/** GET /brand-applications/queue — roles brand-team, admin · POST /brand-applications/:id/decision */
export const BrandQueueSchema = z.object({ items: z.array(BrandApplicationSchema) });

// ---------------------------------------------------------------- product images (0.5.0) [catalog]
/** Image sizes served by catalog (WebP, EXIF stripped): thumb 160 px, card 400 px, full 1000 px (longest side). */
export const ImageSize = z.enum(['thumb', 'card', 'full']);
export type ImageSize = z.infer<typeof ImageSize>;
/** Public, cacheable URLs (relative to the site origin; /api → Kong):
 *  GET /api/catalog/v1/images/:imageId/:size            — one image (Cache-Control immutable)
 *  GET /api/catalog/v1/products/:productId/image/:size   — the product's primary image (302 → image) or 404
 *  GET /api/catalog/v1/categories/:id/image/:size        — category banner photo or 404 */
export const imageUrl = (imageId: string, size: ImageSize = 'card') => `/api/catalog/v1/images/${imageId}/${size}`;
export const productImageUrl = (productId: string, size: ImageSize = 'card') => `/api/catalog/v1/products/${productId}/image/${size}`;
export const categoryImageUrl = (categoryId: string, size: ImageSize = 'full') => `/api/catalog/v1/categories/${categoryId}/image/${size}`;
export const AttributionSchema = z.object({ creator: z.string(), license: z.string(), licenseUrl: z.url().nullable(), sourceUrl: z.url(), title: z.string() });
export const ProductImageSchema = z.object({
  imageId: z.uuid(),
  position: z.int().min(0),
  alt: z.string(),
  width: z.int(),
  height: z.int(),
  /** stock photo credit (demo catalogue); null for seller uploads */
  attribution: AttributionSchema.nullable(),
});
export type ProductImage = z.infer<typeof ProductImageSchema>;
/** POST /products/:productId/images (multipart field `file`; jpeg/png/webp ≤ 5 MB, ≥ 500 px; max 5 per product) — creator or brand owner
 *  DELETE /products/:productId/images/:imageId · PUT /products/:productId/images/order { imageIds } (first = primary) */
export const ImageOrderInputSchema = z.object({ imageIds: z.array(z.uuid()).min(1).max(5) });
export const ImageRejectionSchema = z.object({ code: z.enum(['NOT_OWNER', 'TOO_MANY_IMAGES', 'UNSUPPORTED_TYPE', 'TOO_LARGE', 'TOO_SMALL']), message: z.string() });

export const CategorySchema = z.object({ id: z.string(), name: z.string(), gated: z.boolean(), requirement: z.string().nullable(), hasImage: z.boolean().optional() });
/** GET /categories — public */
export const CategoriesSchema = z.object({ categories: z.array(CategorySchema) });

/** GET /sellers/me/eligibility — role seller: what this seller may list (catalog's local read model) */
export const SellerEligibilitySchema = z.object({
  verified: z.boolean(),
  approvedCategories: z.array(z.string()),
  ownedBrands: z.array(z.string()),
  authorizedBrands: z.array(z.string()),
});

/** POST /products — role seller: a NEW product in the shared catalog (goes to moderation) */
export const ProductInputSchema = z.object({
  title: z.string().trim().min(5).max(150),
  brand: z.string().trim().min(2).max(60),
  category: z.string(),
  description: z.string().trim().min(20).max(2000),
  bullets: z.array(z.string().trim().min(3).max(200)).min(1).max(5),
  /** the creator's own first offer, created together with the product */
  offer: z.object({ sellerSku: z.string().trim().min(2).max(40), priceMinor: z.int().positive(), mrpMinor: z.int().positive().optional(), quantity: z.int().min(0).max(100000) }),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;

/** POST /offers — role seller: sell an EXISTING published product */
export const OfferInputSchema = z.object({ productId: z.uuid(), sellerSku: z.string().trim().min(2).max(40), priceMinor: z.int().positive(), mrpMinor: z.int().positive().optional(), quantity: z.int().min(0).max(100000) });
export type OfferInput = z.infer<typeof OfferInputSchema>;

/** 422 body for rule violations on POST /products and /offers */
export const ListingRejectionSchema = z.object({
  code: z.enum(['SELLER_NOT_VERIFIED', 'CATEGORY_NOT_APPROVED', 'BRAND_RESTRICTED', 'BRAND_NOT_OWNED', 'PRODUCT_NOT_PUBLISHED', 'DUPLICATE_OFFER', 'PRICE_ABOVE_MRP']),
  message: z.string(),
});

export const ProductStatus = z.enum(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'DELISTED']);
export const ProductCardSchema = z.object({ productId: z.uuid(), title: z.string(), brand: z.string(), category: z.string(), minPriceMinor: Minor, mrpMinor: Minor.nullable(), offerCount: z.int(),
  /** 0.5.0: primary image id (null = no image → show the category placeholder) */
  imageId: z.uuid().nullable().optional() });
/** GET /products?q=&category=&page= — public (published only) */
export const ProductSearchSchema = z.object({ currency: z.string(), total: z.int(), page: z.int(), pageSize: z.int(), items: z.array(ProductCardSchema) });
/** GET /products/:id — public */
export const ProductDetailSchema = z.object({
  currency: z.string(),
  productId: z.uuid(),
  title: z.string(),
  brand: z.object({ name: z.string(), restricted: z.boolean(), ownerName: z.string().nullable() }),
  category: z.string(),
  description: z.string(),
  bullets: z.array(z.string()),
  status: ProductStatus,
  offers: z.array(z.object({ offerId: z.uuid(), sellerId: z.uuid(), sellerName: z.string(), priceMinor: Minor, mrpMinor: Minor.nullable() })),
  /** 0.5.0: gallery, primary first */
  images: z.array(ProductImageSchema).optional(),
});
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

/** GET /sellers/me/listings — role seller: my offers and the products I created */
export const MyListingsSchema = z.object({
  currency: z.string(),
  offers: z.array(z.object({ offerId: z.uuid(), productId: z.uuid(), title: z.string(), brand: z.string(), category: z.string(), sellerSku: z.string(), priceMinor: Minor, status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING_PRODUCT']), createdAt: IsoDate })),
  products: z.array(z.object({ productId: z.uuid(), title: z.string(), brand: z.string(), category: z.string(), status: ProductStatus, moderationNote: z.string().nullable(), createdAt: IsoDate })),
});

// ================================================================ moderation decisions [admin]
/** POST /moderation/:itemId/decision — roles moderator, admin (APPROVE | REJECT; REQUEST_CHANGES treated as REJECT with note) */
export const ModerationDecisionInputSchema = DecisionInputSchema;

// ================================================================ fees [payment]
export const ClosingFeeBandSchema = z.object({ upToMinor: Minor.nullable(), feeMinor: Minor.min(0) });
export const FeeRuleSchema = z.object({
  category: z.string(),
  referralBps: z.int().min(0).max(5000),
  minReferralMinor: Minor.min(0),
  closingFees: z.array(ClosingFeeBandSchema).min(1),
});
export const FeeScheduleStatus = z.enum(['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'REJECTED']);
export const FeeScheduleSchema = z.object({
  scheduleId: z.uuid(),
  version: z.int(),
  status: FeeScheduleStatus,
  effectiveFrom: IsoDate.nullable(),
  paymentFeeBps: z.int().min(0).max(1000),
  gstBps: z.int().min(0).max(3000),
  rules: z.array(FeeRuleSchema),
  note: z.string().nullable(),
  createdBy: z.string(),
  submittedBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  createdAt: IsoDate,
  approvedAt: IsoDate.nullable(),
  rowVersion: z.int(),
});
export type FeeSchedule = z.infer<typeof FeeScheduleSchema>;
/** GET /fees/schedule — public: the ACTIVE schedule · GET /fees/schedules — roles finance, admin: all versions */
export const FeeSchedulesSchema = z.object({ items: z.array(FeeScheduleSchema) });
/** POST /fees/schedules (finance: new DRAFT copied from ACTIVE) · PUT /fees/schedules/:id (finance, DRAFT only) ·
 *  POST /fees/schedules/:id/submit (finance) · POST /fees/schedules/:id/approve|reject (admin; never the creator or submitter) */
export const FeeScheduleUpdateSchema = z.object({ paymentFeeBps: z.int().min(0).max(1000), gstBps: z.int().min(0).max(3000), rules: z.array(FeeRuleSchema).min(1), note: Note.optional(), rowVersion: z.int() });

/** POST /fees/preview — public: what a sale costs the seller under the ACTIVE schedule */
export const FeePreviewInputSchema = z.object({ category: z.string(), priceMinor: z.int().positive(), quantity: z.int().min(1).max(1000).default(1) });
export const FeeBreakdownSchema = z.object({
  currency: z.string(),
  scheduleVersion: z.int(),
  saleMinor: Minor,
  referralMinor: Minor,
  closingMinor: Minor,
  paymentMinor: Minor,
  gstMinor: Minor,
  totalFeesMinor: Minor,
  sellerEarnsMinor: Minor,
  effectiveRate: z.number(),
});
export type FeeBreakdown = z.infer<typeof FeeBreakdownSchema>;

/** GET /sellers/me/fees — role seller: fees charged on my sales in the last 30 days */
export const SellerFeesSchema = z.object({
  currency: z.string(),
  totals: z.object({ salesMinor: Minor, referralMinor: Minor, closingMinor: Minor, paymentMinor: Minor, gstMinor: Minor, totalFeesMinor: Minor }),
  byCategory: z.array(z.object({ category: z.string(), salesMinor: Minor, feesMinor: Minor })),
});

/** Additive: FinancePaymentsDashboard.fees (platform fee revenue, 30 days) is optional on the finance dashboard. */
export const PlatformFeesSchema = z.object({ referralMinor: Minor, closingMinor: Minor, paymentMinor: Minor, gstMinor: Minor, totalMinor: Minor });

// Events: user.seller_verified.v1, user.category_approved.v1, catalog.brand_approved.v1, catalog.product_submitted.v1,
// catalog.offer_created.v1, admin.moderation_decided.v1 — schemas in the `Events` catalog (index.ts).
