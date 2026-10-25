/**
 * P2 transactions: cart, checkout saga, stock reservations, payments (test provider + Stripe), order lifecycle,
 * fraud scoring, notifications. Contracts 0.6.0 — all additive. Owning service in brackets; public endpoints are
 * under /api/<service>/v1/…, internal (service-to-service) endpoints under /v1/internal/… and need the realm role
 * `service` (client-credentials token of the `services` client).
 * SKU = catalog OFFER id (one seller's offer for one product).
 */
import { z } from 'zod';

const Minor = z.int();
const IsoDate = z.iso.datetime();

// ================================================================ cart [order]
/** Guest carts: the zone BFF sends `X-Cart-Session: <128-bit random id from the httpOnly ac_cart cookie>`; signed-in
 *  carts are keyed by the token's sub. POST /cart/merge (signed in + X-Cart-Session) moves the guest cart in. */
export const CartItemInputSchema = z.object({ offerId: z.uuid(), qty: z.int().min(1).max(10) });
export const CartQtyInputSchema = z.object({ qty: z.int().min(0).max(10) }); // 0 = remove
export const CartLineSchema = z.object({
  offerId: z.uuid(),
  productId: z.uuid(),
  title: z.string(),
  category: z.string(),
  sellerId: z.uuid(),
  sellerName: z.string(),
  qty: z.int(),
  unitPriceMinor: Minor,
  mrpMinor: Minor.nullable(),
  /** price when added (shown as "price changed" when different) */
  addedPriceMinor: Minor,
  available: z.int(),
  status: z.enum(['OK', 'PRICE_CHANGED', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNAVAILABLE']),
  lineTotalMinor: Minor,
});
export type CartLine = z.infer<typeof CartLineSchema>;
/** GET /cart · POST /cart/items · PATCH /cart/items/:offerId · DELETE /cart/items/:offerId — all return the cart */
export const CartSchema = z.object({
  currency: z.string(),
  lines: z.array(CartLineSchema),
  itemCount: z.int(),
  subtotalMinor: Minor,
  shippingMinor: Minor,
  totalMinor: Minor,
  /** GST is included in prices (India, MRP inclusive) */
  taxIncluded: z.literal(true),
  canCheckout: z.boolean(),
  /** free shipping per seller when that seller's subtotal ≥ this */
  freeShippingOverMinor: Minor,
});
export type Cart = z.infer<typeof CartSchema>;

// ================================================================ checkout [order]
export const AddressSchema = z.object({
  name: z.string().trim().min(2).max(80),
  line1: z.string().trim().min(3).max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().regex(/^\d{6}$/),
  phone: z.string().regex(/^[6-9]\d{9}$/),
});
export type Address = z.infer<typeof AddressSchema>;
export const PaymentProvider = z.enum(['testpay', 'stripe']);
/** POST /checkout — role buyer; Idempotency-Key required. Uses the caller's cart. */
export const CheckoutInputSchema = z.object({ shippingAddress: AddressSchema, provider: PaymentProvider.default('testpay'), expectedTotalMinor: z.int().min(0) });
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;
export const PaymentSessionSchema = z.object({
  paymentId: z.uuid(),
  provider: PaymentProvider,
  amountMinor: Minor,
  currency: z.string(),
  status: z.enum(['REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED']),
  /** stripe: PaymentIntent client secret for Stripe Elements */
  clientSecret: z.string().nullable(),
  /** stripe: publishable key to use with the client secret */
  publishableKey: z.string().nullable(),
  expiresAt: IsoDate,
});
export type PaymentSession = z.infer<typeof PaymentSessionSchema>;
export const CheckoutResultSchema = z.object({ orderId: z.uuid(), orderNo: z.string(), status: z.string(), totalMinor: Minor, payment: PaymentSessionSchema });
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;
/** 409/422 body for POST /checkout */
export const CheckoutRejectionSchema = z.object({
  code: z.enum(['CART_EMPTY', 'TOTAL_CHANGED', 'OUT_OF_STOCK', 'OFFER_UNAVAILABLE', 'RISK_BLOCKED', 'DEPENDENCY_UNAVAILABLE']),
  message: z.string(),
  offerIds: z.array(z.uuid()).default([]),
});

// ================================================================ orders [order]
export const OrderLifecycleStatus = z.enum(['CREATED', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED', 'REJECTED', 'RETURN_IN_PROGRESS', 'REFUNDED']);
export const SellerOrderStatus = z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']);
/** GET /orders/:id — buyer who placed it (or admin/support) */
export const OrderDetailSchema = z.object({
  currency: z.string(),
  orderId: z.uuid(),
  orderNo: z.string(),
  status: OrderLifecycleStatus,
  placedAt: IsoDate,
  subtotalMinor: Minor,
  shippingMinor: Minor,
  totalMinor: Minor,
  shippingAddress: AddressSchema.nullable(),
  riskDecision: z.enum(['ALLOW', 'REVIEW', 'BLOCK']).nullable(),
  payment: z.object({ paymentId: z.uuid(), provider: PaymentProvider, status: z.string() }).nullable(),
  sellerOrders: z.array(z.object({
    sellerOrderId: z.uuid(),
    sellerId: z.uuid(),
    sellerName: z.string(),
    status: SellerOrderStatus,
    carrier: z.string().nullable(),
    trackingNo: z.string().nullable(),
    shippedAt: IsoDate.nullable(),
    deliveredAt: IsoDate.nullable(),
    lines: z.array(z.object({ offerId: z.uuid().nullable(), productId: z.uuid(), title: z.string(), qty: z.int(), unitPriceMinor: Minor })),
  })),
  timeline: z.array(z.object({ status: z.string(), at: IsoDate, actor: z.string() })),
  canCancel: z.boolean(),
});
export type OrderDetail = z.infer<typeof OrderDetailSchema>;
/** POST /orders/:id/cancel { reason } — buyer, before any seller order shipped */
export const CancelInputSchema = z.object({ reason: z.string().trim().min(2).max(200) });
/** POST /seller-orders/:id/ship — seller who owns it */
export const ShipInputSchema = z.object({ carrier: z.enum(['Delhivery', 'Blue Dart', 'DTDC', 'India Post', 'Ekart']), trackingNo: z.string().trim().regex(/^[A-Z0-9]{8,20}$/, '8–20 letters/digits') });
/** GET /sellers/me/orders?status= — seller's sub-orders to act on */
export const SellerOrderListSchema = z.object({
  currency: z.string(),
  items: z.array(z.object({
    sellerOrderId: z.uuid(), orderNo: z.string(), status: SellerOrderStatus, placedAt: IsoDate, shipBy: IsoDate,
    buyerCity: z.string().nullable(), totalMinor: Minor, carrier: z.string().nullable(), trackingNo: z.string().nullable(),
    lines: z.array(z.object({ productId: z.uuid(), title: z.string(), qty: z.int(), unitPriceMinor: Minor })),
  })),
});

// ================================================================ inventory [inventory]
/** POST /internal/reservations — idempotent on orderId; all-or-nothing; 409 InsufficientStock */
export const ReservationInputSchema = z.object({ orderId: z.uuid(), ttlSec: z.int().min(60).max(3600).default(900), lines: z.array(z.object({ skuId: z.uuid(), qty: z.int().min(1) })).min(1) });
export const ReservationSchema = z.object({ orderId: z.uuid(), status: z.enum(['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED']), expiresAt: IsoDate });
export const InsufficientStockSchema = z.object({ code: z.literal('INSUFFICIENT_STOCK'), skuIds: z.array(z.uuid()) });
/** GET /stock?skuIds=a,b — public display stock (never used for decisions) */
export const StockLevelsSchema = z.object({ items: z.array(z.object({ skuId: z.uuid(), available: z.int() })) });
/** PUT /sellers/me/stock/:skuId { onHand } — seller restock/adjust */
export const StockAdjustInputSchema = z.object({ onHand: z.int().min(0).max(100000) });

// ================================================================ catalog (internal reads for re-pricing) [catalog]
/** GET /offers?ids=a,b — public: current offer price/status for cart + checkout re-pricing */
export const OfferLookupSchema = z.object({
  currency: z.string(),
  items: z.array(z.object({ offerId: z.uuid(), productId: z.uuid(), title: z.string(), category: z.string(), sellerId: z.uuid(), sellerName: z.string(), priceMinor: Minor, mrpMinor: Minor.nullable(), active: z.boolean() })),
});

// ================================================================ fraud [fraud]
/** POST /internal/risk/score — sync, callers time out at 300 ms and default to REVIEW.
 *  purpose 'checkout' (default) scores once per order and counts toward the buyer's velocity; 'refund' (0.7.1) is a
 *  read-only lookup for agents: the checkout score when one exists, else a fresh evaluation that is neither stored nor
 *  counted as an order. */
export const RiskInputSchema = z.object({ orderId: z.uuid(), buyerId: z.uuid(), totalMinor: Minor, itemCount: z.int(), sellerIds: z.array(z.uuid()), pincode: z.string(), accountCreatedAt: IsoDate.nullable(), purpose: z.enum(['checkout', 'refund']).default('checkout') });
export const RiskResultSchema = z.object({ orderId: z.uuid(), decision: z.enum(['ALLOW', 'REVIEW', 'BLOCK']), score: z.number().min(0).max(1), rules: z.array(z.string()) });
export type RiskResult = z.infer<typeof RiskResultSchema>;

// ================================================================ payment [payment]
/** POST /internal/payments — idempotent on orderId; creates the provider session */
export const PaymentCreateInputSchema = z.object({ orderId: z.uuid(), orderNo: z.string(), buyerId: z.uuid(), amountMinor: z.int().positive(), currency: z.string().length(3), provider: PaymentProvider, expiresAt: IsoDate });
/** GET /payments/:id — the buyer who owns it: session to render the pay page */
export const PaymentViewSchema = PaymentSessionSchema.extend({ orderId: z.uuid(), orderNo: z.string(), failureReason: z.string().nullable() });
/** POST /payments/:id/testpay — buyer: pay with a TEST card (no real money). 4242 4242 4242 4242 succeeds,
 *  4000 0000 0000 0002 is declined, 4000 0000 0000 9995 fails with insufficient funds. The provider then delivers
 *  a signed webhook to POST /webhooks/testpay exactly like a real gateway (truth = verified, deduped webhooks). */
export const TestPayInputSchema = z.object({ cardNumber: z.string().regex(/^[\d ]{16,19}$/), expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/), cvc: z.string().regex(/^\d{3,4}$/), name: z.string().trim().min(2).max(80) });

// Events (schemas in the `Events` catalog, index.ts): order.created.v1 (lines carry offer/product/category),
// order.confirmed.v1, order.cancelled.v1, order.shipped.v1, order.delivered.v1, inventory.stock_reserved.v1,
// inventory.reservation_released.v1, inventory.stock_committed.v1, inventory.low_stock.v1, payment.failed.v1,
// payment.refunded.v1, fraud.order_scored.v1, catalog.offer_updated.v1.
