/**
 * Role dashboards — read models served by the OWNING service over its own database and composed by the
 * zone BFF (each widget independent: one failing service degrades one tile, not the page).
 * Endpoint per DTO is noted on each schema. All money = integer minor units + currency.
 */
import { z } from 'zod';

const Minor = z.int();
const Currency = z.string().regex(/^[A-Z]{3}$/);
const IsoDate = z.iso.datetime();
const Day = z.iso.date();

export const DayPointSchema = z.object({ day: Day, value: z.number() });

// ---------------------------------------------------------------- order service
export const OrderStatus = z.enum(['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_IN_PROGRESS', 'REFUNDED']);

/** GET /api/order/v1/dashboard/buyer — role buyer (own orders only) */
export const BuyerOrdersDashboardSchema = z.object({
  currency: Currency,
  kpis: z.object({ orders: z.int(), inTransit: z.int(), delivered: z.int(), spent90dMinor: Minor }),
  recentOrders: z.array(z.object({ orderNo: z.string(), status: OrderStatus, totalMinor: Minor, items: z.int(), placedAt: IsoDate })),
});

/** GET /api/order/v1/dashboard/seller — role seller (own sub-orders only) */
export const SellerOrdersDashboardSchema = z.object({
  currency: Currency,
  toShip: z.array(z.object({ orderNo: z.string(), items: z.int(), totalMinor: Minor, placedAt: IsoDate, ageHours: z.number() })),
  byStatus: z.array(z.object({ status: OrderStatus, count: z.int() })),
  /** 0.3.0: account-health inputs — unshipped sub-orders, those older than 48 h, and shipments in the last 30 days */
  shipping: z.object({ unshipped: z.int(), late: z.int(), shipped30d: z.int(), lateShipped30d: z.int() }).optional(),
});

/** GET /api/order/v1/dashboard/platform — roles admin, finance */
export const PlatformOrdersDashboardSchema = z.object({
  currency: Currency,
  kpis: z.object({ gmv30dMinor: Minor, orders30d: z.int(), aovMinor: Minor, activeBuyers30d: z.int() }),
  gmvByDay: z.array(DayPointSchema),
});

// ---------------------------------------------------------------- returns service
export const RefundCaseStatus = z.enum(['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'AUTO_APPROVED', 'PENDING_HUMAN', 'APPROVED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED', 'CLOSED']);
const RefundCase = z.object({
  caseId: z.uuid(),
  orderNo: z.string(),
  reason: z.string(),
  status: RefundCaseStatus,
  requestedMinor: Minor,
  proposedMinor: Minor.nullable(),
  riskScore: z.number().min(0).max(1).nullable(),
  requiredRole: z.enum(['support', 'finance']).nullable(),
  openedAt: IsoDate,
  ageHours: z.number(),
  agentRationale: z.string().nullable(),
});

/** GET /api/returns/v1/dashboard/buyer — role buyer */
export const BuyerReturnsDashboardSchema = z.object({ currency: Currency, open: z.int(), cases: z.array(RefundCase) });

/** GET /api/returns/v1/dashboard/support — roles support, admin */
export const SupportDashboardSchema = z.object({
  currency: Currency,
  kpis: z.object({ pendingHuman: z.int(), autoApproved7d: z.int(), approved7d: z.int(), rejected7d: z.int(), medianHoursToResolve: z.number() }),
  queue: z.array(RefundCase),
  resolvedByDay: z.array(DayPointSchema),
});

/** GET /api/returns/v1/dashboard/finance — roles finance, admin (dual control: high-value refunds) */
export const FinanceRefundsDashboardSchema = z.object({
  currency: Currency,
  awaitingFinance: z.array(RefundCase),
  refunded30dMinor: Minor,
  autoApprovedShare30d: z.number().min(0).max(1),
});

// ---------------------------------------------------------------- seller-analytics service
/** GET /api/seller-analytics/v1/dashboard/seller — role seller */
export const SellerSalesDashboardSchema = z.object({
  currency: Currency,
  kpis: z.object({ gmv30dMinor: Minor, orders30d: z.int(), aovMinor: Minor, refundRate30d: z.number().min(0).max(1) }),
  /** 0.3.0: sales so far today (Seller Central snapshot) */
  today: z.object({ gmvMinor: Minor, orders: z.int(), units: z.int() }).optional(),
  salesByDay: z.array(DayPointSchema),
  topProducts: z.array(z.object({ title: z.string(), units: z.int(), grossMinor: Minor, /** 0.5.0 */ productId: z.uuid().optional() })),
  payouts: z.object({ pendingMinor: Minor, nextPayoutOn: Day.nullable(), recent: z.array(z.object({ paidOn: Day, amountMinor: Minor })) }),
});

// ---------------------------------------------------------------- inventory service
/** GET /api/inventory/v1/dashboard/seller — role seller */
export const SellerStockDashboardSchema = z.object({
  totalSkus: z.int(),
  outOfStock: z.int(),
  lowStock: z.array(z.object({ sku: z.string(), title: z.string(), available: z.int(), threshold: z.int(), /** 0.5.0 */ productId: z.uuid().optional() })),
});

// ---------------------------------------------------------------- payment service
/** GET /api/payment/v1/dashboard/finance — roles finance, admin */
export const FinancePaymentsDashboardSchema = z.object({
  currency: Currency,
  kpis: z.object({ captured30dMinor: Minor, refunded30dMinor: Minor, payoutsPendingMinor: Minor, payoutsPaid30dMinor: Minor }),
  capturedByDay: z.array(DayPointSchema),
  upcomingPayouts: z.array(z.object({ sellerName: z.string(), amountMinor: Minor, scheduledOn: Day })),
  ledger: z.object({ balanced: z.boolean(), debitMinor: Minor, creditMinor: Minor, checkedAt: IsoDate }),
  /** 0.4.0: platform fee revenue, 30 days */
  fees: z.object({ referralMinor: Minor, closingMinor: Minor, paymentMinor: Minor, gstMinor: Minor, totalMinor: Minor }).optional(),
});

// ---------------------------------------------------------------- fraud service
export const AlertStatus = z.enum(['OPEN', 'INVESTIGATING', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE']);
/** GET /api/fraud/v1/dashboard — roles fraud-analyst, admin */
export const FraudDashboardSchema = z.object({
  kpis: z.object({ open: z.int(), investigating: z.int(), confirmed30d: z.int(), falsePositive30d: z.int() }),
  scoreBuckets: z.array(z.object({ bucket: z.string(), count: z.int() })),
  topRules: z.array(z.object({ rule: z.string(), count: z.int() })),
  recentAlerts: z.array(z.object({ alertId: z.uuid(), subject: z.string(), score: z.number(), decision: z.enum(['ALLOW', 'REVIEW', 'BLOCK']), status: AlertStatus, rules: z.array(z.string()), raisedAt: IsoDate })),
});

// ---------------------------------------------------------------- catalog service
/** GET /api/catalog/v1/dashboard — roles admin, moderator */
export const CatalogDashboardSchema = z.object({ published: z.int(), draft: z.int(), pendingReview: z.int(), rejected: z.int(), sellers: z.int() });

// ---------------------------------------------------------------- admin service
/** GET /api/admin/v1/dashboard/moderation — roles moderator, admin */
export const ModerationDashboardSchema = z.object({
  kpis: z.object({ pending: z.int(), autoApproved7d: z.int(), humanDecided7d: z.int(), autoApprovalRate7d: z.number().min(0).max(1) }),
  verdicts7d: z.array(z.object({ verdict: z.enum(['APPROVE', 'NEEDS_REVIEW', 'REJECT']), count: z.int() })),
  queue: z.array(z.object({ itemId: z.uuid(), title: z.string(), sellerName: z.string(), agentVerdict: z.enum(['APPROVE', 'NEEDS_REVIEW', 'REJECT']), confidence: z.number(), reasons: z.array(z.string()), ageHours: z.number(),
    /** 0.4.1: needed to decide an item (POST /api/admin/v1/moderation/:itemId/decision) */
    version: z.int().optional(), productId: z.uuid().optional(), brand: z.string().optional(), category: z.string().optional() })),
});

/** GET /api/admin/v1/dashboard/overview — role admin */
export const AdminOverviewDashboardSchema = z.object({ openDisputes: z.int(), pendingModeration: z.int(), sanctionedSellers: z.int() });

/** GET /api/admin/v1/dashboard/platform-health — role admin (admin service probes every service via Kong) */
export const PlatformHealthSchema = z.object({
  checkedAt: IsoDate,
  services: z.array(z.object({ name: z.string(), status: z.enum(['ok', 'degraded', 'down']), db: z.enum(['up', 'down', 'none']), latencyMs: z.number() })),
});

// ---------------------------------------------------------------- agents service
/** GET /api/agents/v1/dashboard — role admin (agent oversight; real audit data, never seeded) */
export const AgentsDashboardSchema = z.object({
  agents: z.array(z.object({ id: z.string(), version: z.string(), autonomy: z.int().min(0).max(4), description: z.string() })),
  toolCalls24h: z.object({ total: z.int(), allowed: z.int(), denied: z.int(), errors: z.int() }),
  byTool: z.array(z.object({ tool: z.string(), count: z.int(), denied: z.int() })),
  recent: z.array(z.object({ at: IsoDate, agent: z.string(), tool: z.string(), tier: z.string(), allowed: z.boolean(), result: z.string(), reasons: z.array(z.string()) })),
  chainIntact: z.boolean(),
});

export type BuyerOrdersDashboard = z.infer<typeof BuyerOrdersDashboardSchema>;
export type SellerOrdersDashboard = z.infer<typeof SellerOrdersDashboardSchema>;
export type PlatformOrdersDashboard = z.infer<typeof PlatformOrdersDashboardSchema>;
export type BuyerReturnsDashboard = z.infer<typeof BuyerReturnsDashboardSchema>;
export type SupportDashboard = z.infer<typeof SupportDashboardSchema>;
export type FinanceRefundsDashboard = z.infer<typeof FinanceRefundsDashboardSchema>;
export type SellerSalesDashboard = z.infer<typeof SellerSalesDashboardSchema>;
export type SellerStockDashboard = z.infer<typeof SellerStockDashboardSchema>;
export type FinancePaymentsDashboard = z.infer<typeof FinancePaymentsDashboardSchema>;
export type FraudDashboard = z.infer<typeof FraudDashboardSchema>;
export type CatalogDashboard = z.infer<typeof CatalogDashboardSchema>;
export type ModerationDashboard = z.infer<typeof ModerationDashboardSchema>;
export type AdminOverviewDashboard = z.infer<typeof AdminOverviewDashboardSchema>;
export type PlatformHealth = z.infer<typeof PlatformHealthSchema>;
export type AgentsDashboard = z.infer<typeof AgentsDashboardSchema>;
export type DayPoint = z.infer<typeof DayPointSchema>;
export type RefundCaseView = z.infer<typeof RefundCase>;

// ================================================================ 0.3.0 — Amazon-style buyer & seller pages (additive)

/** GET /api/order/v1/orders/mine?tab=all|not-shipped|cancelled&range=3m|6m|12m&page=1 — role buyer ("Your Orders") */
export const BuyerOrdersTab = z.enum(['all', 'not-shipped', 'cancelled']);
export const BuyerOrderLineSchema = z.object({
  productId: z.uuid(),
  title: z.string(),
  category: z.string(),
  sellerName: z.string(),
  qty: z.int(),
  unitPriceMinor: Minor,
});
export const BuyerOrderCardSchema = z.object({
  orderNo: z.string(),
  status: OrderStatus,
  placedAt: IsoDate,
  totalMinor: Minor,
  shipToName: z.string(),
  shipToCity: z.string(),
  shippedAt: IsoDate.nullable(),
  deliveredAt: IsoDate.nullable(),
  /** estimated delivery for orders not delivered yet */
  eta: IsoDate.nullable(),
  lines: z.array(BuyerOrderLineSchema),
  /** 0.6.1: links + the order's own lifecycle status (`status` above is the dashboard-level mapping) */
  orderId: z.uuid().optional(),
  paymentId: z.uuid().nullable().optional(),
  lifecycleStatus: z.string().optional(),
});
export const BuyerOrdersPageSchema = z.object({
  currency: Currency,
  tab: BuyerOrdersTab,
  range: z.enum(['3m', '6m', '12m']),
  page: z.int(),
  pageSize: z.int(),
  total: z.int(),
  counts: z.object({ all: z.int(), notShipped: z.int(), cancelled: z.int() }),
  orders: z.array(BuyerOrderCardSchema),
});

/** GET /api/order/v1/orders/mine/buy-again — role buyer ("Buy Again": delivered products, most ordered first) */
export const BuyAgainSchema = z.object({
  currency: Currency,
  items: z.array(z.object({ productId: z.uuid(), title: z.string(), category: z.string(), lastPriceMinor: Minor, lastOrderedAt: IsoDate, timesOrdered: z.int() })),
});

/** Additive fields on the seller dashboards (Seller Central "Global Snapshot") */

export type BuyerOrdersPage = z.infer<typeof BuyerOrdersPageSchema>;
export type BuyerOrderCard = z.infer<typeof BuyerOrderCardSchema>;
export type BuyAgain = z.infer<typeof BuyAgainSchema>;
