/**
 * Shared contracts: zod schemas for DTOs and domain events (CloudEvents 1.0 envelope).
 * Services validate requests with these; the web app imports the inferred types.
 * Event type naming: `<domain>.<thing_happened>.v<N>` — never change a published version, add v<N+1>.
 */
import { z } from 'zod';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
export const MoneySchema = z.object({ amountMinor: z.int(), currency: CurrencySchema });
export type MoneyDto = z.infer<typeof MoneySchema>;

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------- events
export const TOPICS = {
  user: 'user.events',
  catalog: 'catalog.events',
  inventory: 'inventory.events',
  order: 'order.events',
  payment: 'payment.events',
  returns: 'returns.events',
  fraud: 'fraud.events',
  admin: 'admin.events',
  agent: 'agent.events',
  dlq: 'dlq.events',
} as const;
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const CloudEventBase = z.object({
  specversion: z.literal('1.0'),
  id: z.string().min(1),
  source: z.string().min(1),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+\.v\d+$/),
  subject: z.string().optional(),
  time: z.iso.datetime(),
  traceparent: z.string().optional(),
  datacontenttype: z.literal('application/json').default('application/json'),
});

export const cloudEventSchema = <T extends z.ZodType>(type: string, data: T) =>
  CloudEventBase.extend({ type: z.literal(type), data });

export type CloudEvent<T = unknown> = z.infer<typeof CloudEventBase> & { data: T };

const OrderLine = z.object({
  skuId: z.uuid(), sellerId: z.uuid(), qty: z.int().positive(), unitPriceMinor: z.int().nonnegative(),
  /** 0.6.0 (optional): skuId is the catalog offer id */
  productId: z.uuid().optional(), category: z.string().optional(), title: z.string().optional(), sellerOrderId: z.uuid().optional(),
});
const SkuQty = z.object({ skuId: z.uuid(), qty: z.int().positive() });

/** Event catalog — add every new event here with its schema (see .claude/skills/domain-event). */
export const Events = {
  'order.created.v1': cloudEventSchema(
    'order.created.v1',
    z.object({ orderId: z.uuid(), buyerId: z.uuid(), total: MoneySchema, lines: z.array(OrderLine).min(1), orderNo: z.string().optional() }),
  ),
  // ---- transactions (0.6.0) — see commerce.ts
  'order.confirmed.v1': cloudEventSchema(
    'order.confirmed.v1',
    z.object({ orderId: z.uuid(), orderNo: z.string(), buyerId: z.uuid(), notifyEmail: z.email().nullable(), total: MoneySchema, lines: z.array(OrderLine).min(1) }),
  ),
  'order.cancelled.v1': cloudEventSchema(
    'order.cancelled.v1',
    z.object({ orderId: z.uuid(), orderNo: z.string(), buyerId: z.uuid(), notifyEmail: z.email().nullable(), reason: z.enum(['BUYER_CANCELLED', 'PAYMENT_EXPIRED', 'PAYMENT_FAILED', 'RISK_REJECTED', 'OUT_OF_STOCK']), note: z.string(), refundRequired: z.boolean(), amount: MoneySchema }),
  ),
  'order.shipped.v1': cloudEventSchema(
    'order.shipped.v1',
    z.object({ orderId: z.uuid(), orderNo: z.string(), sellerOrderId: z.uuid(), sellerId: z.uuid(), buyerId: z.uuid(), notifyEmail: z.email().nullable(), carrier: z.string(), trackingNo: z.string() }),
  ),
  'order.delivered.v1': cloudEventSchema(
    'order.delivered.v1',
    z.object({ orderId: z.uuid(), orderNo: z.string(), sellerOrderId: z.uuid(), sellerId: z.uuid(), buyerId: z.uuid(), notifyEmail: z.email().nullable() }),
  ),
  'inventory.stock_reserved.v1': cloudEventSchema('inventory.stock_reserved.v1', z.object({ orderId: z.uuid(), lines: z.array(SkuQty).min(1), expiresAt: z.iso.datetime() })),
  'inventory.reservation_released.v1': cloudEventSchema(
    'inventory.reservation_released.v1',
    z.object({ orderId: z.uuid(), reason: z.enum(['EXPIRED', 'PAYMENT_FAILED', 'ORDER_CANCELLED']), lines: z.array(SkuQty) }),
  ),
  'inventory.stock_committed.v1': cloudEventSchema('inventory.stock_committed.v1', z.object({ orderId: z.uuid(), lines: z.array(SkuQty).min(1) })),
  'inventory.low_stock.v1': cloudEventSchema('inventory.low_stock.v1', z.object({ skuId: z.uuid(), sellerId: z.uuid(), available: z.int(), threshold: z.int() })),
  'payment.failed.v1': cloudEventSchema(
    'payment.failed.v1',
    z.object({ paymentId: z.uuid(), orderId: z.uuid(), reason: z.string(), provider: z.enum(['stripe', 'razorpay', 'stub', 'testpay']) }),
  ),
  'payment.refunded.v1': cloudEventSchema(
    'payment.refunded.v1',
    z.object({ refundId: z.uuid(), paymentId: z.uuid(), orderId: z.uuid(), amount: MoneySchema, reason: z.string() }),
  ),
  'fraud.order_scored.v1': cloudEventSchema(
    'fraud.order_scored.v1',
    z.object({ orderId: z.uuid(), buyerId: z.uuid(), decision: z.enum(['ALLOW', 'REVIEW', 'BLOCK']), score: z.number(), rules: z.array(z.string()) }),
  ),
  'catalog.offer_updated.v1': cloudEventSchema(
    'catalog.offer_updated.v1',
    z.object({ offerId: z.uuid(), productId: z.uuid(), sellerId: z.uuid(), priceMinor: z.int(), active: z.boolean() }),
  ),
  'payment.succeeded.v1': cloudEventSchema(
    'payment.succeeded.v1',
    z.object({ paymentId: z.uuid(), orderId: z.uuid(), amount: MoneySchema, provider: z.enum(['stripe', 'razorpay', 'stub', 'testpay']) }),
  ),
  'returns.return_requested.v1': cloudEventSchema(
    'returns.return_requested.v1',
    z.object({ returnId: z.uuid(), caseId: z.uuid(), orderId: z.uuid(), buyerId: z.uuid(), reasonCode: z.string(), /** 0.7.0 */ requestedMinor: z.int().optional(), orderNo: z.string().optional() }),
  ),
  // ---- returns & agents (0.7.0) — see returns.ts
  'returns.case_proposed.v1': cloudEventSchema(
    'returns.case_proposed.v1',
    z.object({ caseId: z.uuid(), orderId: z.uuid(), mode: z.enum(['SHADOW', 'RECOMMEND', 'LIVE']), outcome: z.string(), amountMinor: z.int(), confidence: z.number(), runId: z.string() }),
  ),
  'returns.case_decided.v1': cloudEventSchema(
    'returns.case_decided.v1',
    z.object({ caseId: z.uuid(), orderId: z.uuid(), orderNo: z.string(), buyerId: z.uuid(), sellerId: z.uuid(), outcome: z.string(), amountMinor: z.int(), decidedBy: z.enum(['agent', 'human', 'policy']), status: z.string() }),
  ),
  'returns.refund_executed.v1': cloudEventSchema(
    'returns.refund_executed.v1',
    z.object({ caseId: z.uuid(), orderId: z.uuid(), amountMinor: z.int(), refundId: z.uuid().nullable(), status: z.enum(['REFUND_PENDING', 'REFUNDED', 'FAILED']) }),
  ),
  'agent.run_completed.v1': cloudEventSchema(
    'agent.run_completed.v1',
    z.object({ runId: z.string(), agentId: z.string(), subject: z.string(), mode: z.enum(['SHADOW', 'RECOMMEND', 'LIVE']), status: z.string(), outcome: z.string().nullable(), steps: z.int(), toolCalls: z.int(), deniedCalls: z.int() }),
  ),
  // ---- marketplace (0.4.0) — see marketplace.ts
  'user.seller_verified.v1': cloudEventSchema(
    'user.seller_verified.v1',
    z.object({ sellerId: z.uuid(), displayName: z.string(), businessType: z.enum(['MANUFACTURER', 'BRAND_OWNER', 'DISTRIBUTOR', 'RETAILER']) }),
  ),
  'user.category_approved.v1': cloudEventSchema('user.category_approved.v1', z.object({ sellerId: z.uuid(), category: z.string() })),
  'catalog.brand_approved.v1': cloudEventSchema(
    'catalog.brand_approved.v1',
    z.object({ brandId: z.uuid(), name: z.string(), ownerSellerId: z.uuid(), restricted: z.boolean() }),
  ),
  'catalog.product_submitted.v1': cloudEventSchema(
    'catalog.product_submitted.v1',
    z.object({ productId: z.uuid(), sellerId: z.uuid(), sellerName: z.string(), title: z.string(), brand: z.string(), category: z.string(), description: z.string(), bullets: z.array(z.string()) }),
  ),
  'catalog.offer_created.v1': cloudEventSchema(
    'catalog.offer_created.v1',
    z.object({ offerId: z.uuid(), productId: z.uuid(), sellerId: z.uuid(), sellerSku: z.string(), title: z.string(), quantity: z.int().min(0) }),
  ),
  'admin.moderation_decided.v1': cloudEventSchema(
    'admin.moderation_decided.v1',
    z.object({ productId: z.uuid(), decision: z.enum(['APPROVE', 'REJECT']), note: z.string(), decidedBy: z.enum(['agent', 'human']) }),
  ),
  'agent.escalated.v1': cloudEventSchema(
    'agent.escalated.v1',
    z.object({ runId: z.string(), agentId: z.string(), approvalId: z.uuid(), requiredRole: z.string(), subject: z.string() }),
  ),
} as const;
export type EventType = keyof typeof Events;
export type EventData<T extends EventType> = z.infer<(typeof Events)[T]>['data'];

export function parseEvent<T extends EventType>(type: T, value: unknown) {
  return Events[type].parse(value) as z.infer<(typeof Events)[T]>;
}
export * from './dashboards.js';
export * from './marketplace.js';
export * from './commerce.js';
export * from './returns.js';
