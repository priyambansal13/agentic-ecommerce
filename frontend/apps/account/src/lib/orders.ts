import { BuyerOrderCardSchema, BuyerOrdersPageSchema } from '@ac/contracts';
import { z } from 'zod';

/**
 * Order cards, read leniently: P2 adds lifecycle statuses (CREATED, PAYMENT_FAILED, REJECTED, PARTIALLY_SHIPPED)
 * and the order id / payment id a card needs for its links. Both are optional so older order-service versions
 * still render.
 */
export const OrderCardSchema = BuyerOrderCardSchema.extend({ status: z.string() })
  // contracts 0.6.1: show the order's own lifecycle status (e.g. PAYMENT_FAILED) when the service sends it
  .transform((o) => ({ ...o, status: o.lifecycleStatus ?? o.status }));
export type OrderCardData = z.infer<typeof OrderCardSchema>;
export const OrdersPageSchema = BuyerOrdersPageSchema.extend({ orders: z.array(OrderCardSchema) });
