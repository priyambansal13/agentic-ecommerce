import { load, type Loaded } from '@ac/bff';
import { MyReturnsSchema, type ReturnView, ReturnViewSchema } from '@ac/contracts';

export * from './return-text';

/**
 * A return by id. Links from older dashboards carry the refund CASE id, so when the return id isn't found we look the
 * case up in the buyer's own returns list. Never throws.
 */
export async function loadReturn(id: string): Promise<Loaded<ReturnView>> {
  const direct = await load(ReturnViewSchema, `/api/returns/v1/returns/${id}`);
  if (direct.ok || direct.status !== 404) return direct;
  const mine = await load(MyReturnsSchema, '/api/returns/v1/returns/mine');
  const hit = mine.ok ? mine.data.items.find((r) => r.caseId === id) : undefined;
  return hit ? load(ReturnViewSchema, `/api/returns/v1/returns/${hit.returnId}`) : direct;
}
