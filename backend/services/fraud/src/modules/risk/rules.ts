/** Fraud rules v1 — deterministic, explainable, cheap enough for the 300 ms checkout budget. */
export interface RiskFacts {
  totalMinor: number;
  itemCount: number;
  sellerCount: number;
  pincode: string;
  accountAgeDays: number | null;
  ordersLastHour: number;
  priorOrders: number;
}
export interface RuleHit { rule: string; weight: number }

export const BLOCKED_PINCODES = new Set(['999999', '000000', '110999']);
export const THRESHOLDS = { review: 0.4, block: 0.8 };

export function evaluate(f: RiskFacts): { score: number; decision: 'ALLOW' | 'REVIEW' | 'BLOCK'; rules: string[] } {
  const hits: RuleHit[] = [];
  if (f.totalMinor > 50_000_00) hits.push({ rule: 'high_value_order', weight: 0.45 });
  if (f.accountAgeDays !== null && f.accountAgeDays < 7 && f.totalMinor > 10_000_00) hits.push({ rule: 'new_account_high_value', weight: 0.35 });
  if (f.accountAgeDays === null && f.priorOrders === 0 && f.totalMinor > 10_000_00) hits.push({ rule: 'first_order_high_value', weight: 0.25 });
  if (f.ordersLastHour >= 3) hits.push({ rule: 'velocity_orders_1h', weight: 0.4 });
  if (f.sellerCount >= 4) hits.push({ rule: 'many_sellers', weight: 0.15 });
  if (f.itemCount > 20) hits.push({ rule: 'bulk_quantity', weight: 0.2 });
  if (BLOCKED_PINCODES.has(f.pincode)) hits.push({ rule: 'blocked_pincode', weight: 0.6 });
  const score = Math.min(1, Math.round(hits.reduce((s, h) => s + h.weight, 0) * 100) / 100);
  const decision = score >= THRESHOLDS.block ? 'BLOCK' : score >= THRESHOLDS.review ? 'REVIEW' : 'ALLOW';
  return { score, decision, rules: hits.map((h) => h.rule) };
}
