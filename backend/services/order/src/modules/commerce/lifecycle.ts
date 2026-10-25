/** Order + seller-order state machines, shipping rule and dashboard status mapping (pure — unit tested). */
export type OrderStatus =
  | 'CREATED' | 'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'DELIVERED'
  | 'CANCELLED' | 'PAYMENT_FAILED' | 'REJECTED' | 'RETURN_IN_PROGRESS' | 'REFUNDED';
export type SellerOrderStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['PENDING_PAYMENT', 'REJECTED'],
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'],
  PARTIALLY_SHIPPED: ['SHIPPED', 'DELIVERED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['RETURN_IN_PROGRESS'],
  RETURN_IN_PROGRESS: ['DELIVERED', 'REFUNDED'],
  CANCELLED: [],
  PAYMENT_FAILED: [],
  REJECTED: [],
  REFUNDED: [],
};
export const SELLER_ORDER_TRANSITIONS: Record<SellerOrderStatus, SellerOrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export class IllegalTransition extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`order cannot go from ${from} to ${to}`);
  }
}
export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!ORDER_TRANSITIONS[from]?.includes(to)) throw new IllegalTransition(from, to);
}
export function assertSellerTransition(from: SellerOrderStatus, to: SellerOrderStatus) {
  if (!SELLER_ORDER_TRANSITIONS[from]?.includes(to)) throw new IllegalTransition(from, to);
}

/** buyer may cancel until anything has shipped */
export const CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'CONFIRMED'];
/** a refund is owed when money was captured */
export const refundRequiredFor = (s: OrderStatus) => s === 'PAID' || s === 'CONFIRMED';

/** order status after a seller order shipped/delivered (ignores cancelled sub-orders) */
export function rollUp(subs: SellerOrderStatus[]): OrderStatus | null {
  const live = subs.filter((s) => s !== 'CANCELLED');
  if (!live.length) return null;
  if (live.every((s) => s === 'DELIVERED')) return 'DELIVERED';
  if (live.every((s) => s === 'SHIPPED' || s === 'DELIVERED')) return 'SHIPPED';
  if (live.some((s) => s === 'SHIPPED' || s === 'DELIVERED')) return 'PARTIALLY_SHIPPED';
  return null;
}

// ---------------------------------------------------------------- shipping
export const FREE_SHIPPING_OVER_MINOR = 49_900;
export const SHIPPING_FEE_MINOR = 4_000;
/** ₹40 per seller unless that seller's subtotal reaches ₹499 */
export function shippingFor(lines: { sellerId: string; unitPriceMinor: number; qty: number }[]) {
  const bySeller = new Map<string, number>();
  for (const l of lines) bySeller.set(l.sellerId, (bySeller.get(l.sellerId) ?? 0) + l.unitPriceMinor * l.qty);
  const perSeller = new Map([...bySeller].map(([s, sub]) => [s, sub >= FREE_SHIPPING_OVER_MINOR ? 0 : SHIPPING_FEE_MINOR]));
  return { perSeller, total: [...perSeller.values()].reduce((a, b) => a + b, 0), subtotal: [...bySeller.values()].reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------- dashboards (contract enum is narrower)
/** statuses never shown to buyers on dashboards (checkout never completed) */
export const HIDDEN_FROM_BUYER: OrderStatus[] = ['CREATED', 'REJECTED'];
/** map to the dashboards' OrderStatus enum (0.3.0): PENDING_PAYMENT|PAID|CONFIRMED|SHIPPED|DELIVERED|CANCELLED|RETURN_IN_PROGRESS|REFUNDED */
export function dashboardStatus(s: string) {
  switch (s) {
    case 'CREATED': return 'PENDING_PAYMENT';
    case 'PARTIALLY_SHIPPED': return 'SHIPPED';
    case 'PAYMENT_FAILED':
    case 'REJECTED': return 'CANCELLED';
    default: return s as 'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURN_IN_PROGRESS' | 'REFUNDED';
  }
}
/** seller sub-orders: older rows carry order-level statuses */
export function sellerStatus(s: string): SellerOrderStatus {
  switch (s) {
    case 'PAID': return 'CONFIRMED';
    case 'RETURN_IN_PROGRESS':
    case 'REFUNDED': return 'DELIVERED';
    case 'PAYMENT_FAILED':
    case 'REJECTED': return 'CANCELLED';
    case 'CREATED': return 'PENDING_PAYMENT';
    default: return s as SellerOrderStatus;
  }
}
