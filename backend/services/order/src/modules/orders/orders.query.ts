import { BuyerOrdersTab } from '@ac/contracts';
import { z } from 'zod';

/** Query of GET /v1/orders/mine — invalid values → 400 (ZodPipe). */
export const MyOrdersQuerySchema = z.object({
  tab: BuyerOrdersTab.default('all'),
  range: z.enum(['3m', '6m', '12m']).default('3m'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type MyOrdersQuery = z.infer<typeof MyOrdersQuerySchema>;
