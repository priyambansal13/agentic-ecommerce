import type { PolicyResult, ReasonCode, Resolution } from '@ac/contracts';

/**
 * Refund policy decision table (LLD §2.7) — versioned DATA + one pure evaluator. Deterministic: same inputs →
 * same result. The LLM never overrides a hard rule: agents may only pick from `allowedOutcomes`.
 */
export interface PolicyRules {
  version: string;
  /** days after delivery a return may be requested, per category ('*' = default) */
  returnWindowDays: Record<string, number>;
  /** R1 exception: DAMAGED / WRONG_ITEM may still be claimed within this many days (per category, '*' default) */
  damageWindowDays: Record<string, number>;
  /** R4: perishable categories → REPLACEMENT or STORE_CREDIT only */
  perishable: string[];
  /** CHANGED_MIND only for unopened items in these categories (rule hit, still allowed) */
  unopenedOnly: string[];
  autoMaxMinor: number;
  maxRisk: number;
  maxRefunds90d: number;
  maxRefundRate180d: number;
  dualControlMinor: number;
  /** a request older than this (after delivery) is not accepted at all */
  hardStopDays: number;
}

export const POLICY_V1: PolicyRules = {
  version: 'v1',
  returnWindowDays: { electronics: 7, fashion: 10, home: 10, grocery: 0, beauty: 7, books: 10, jewellery: 7, outdoor: 10, '*': 10 },
  damageWindowDays: { grocery: 3, '*': 30 },
  perishable: ['grocery'],
  unopenedOnly: ['beauty'],
  autoMaxMinor: 200_000, // ₹2,000
  maxRisk: 0.3,
  maxRefunds90d: 2,
  maxRefundRate180d: 0.3,
  dualControlMinor: 2_500_000, // ₹25,000
  hardStopDays: 90,
};

export const RULE_TEXT: { id: string; description: string; effect: string }[] = [
  { id: 'R1', description: 'Return window per category after delivery; DAMAGED or WRONG_ITEM may still be claimed within 30 days (grocery 3 days)', effect: 'REJECT (hard) outside the window' },
  { id: 'R2', description: 'NOT_DELIVERED while the carrier reports delivered and there is no photo', effect: 'PENDING_HUMAN' },
  { id: 'R3', description: 'Amount ≤ ₹2,000, risk < 0.3 and at most 2 refunds in 90 days', effect: 'eligible for automatic approval (agent at L3+)' },
  { id: 'R4', description: 'Perishable categories (grocery)', effect: 'REPLACEMENT or STORE_CREDIT only' },
  { id: 'R5', description: 'Seller disputes the claim within 48 h', effect: 'PENDING_HUMAN (not active: no seller-dispute data yet)' },
  { id: 'R6', description: 'Buyer refund rate over 180 days > 30 %', effect: 'PENDING_HUMAN + fraud signal' },
  { id: 'R7', description: 'Amount above ₹25,000', effect: 'dual control: support + finance' },
  { id: 'R8', description: 'Risk signals in the claim (injection attempt in buyer text, reused photo)', effect: 'PENDING_HUMAN' },
  { id: 'R9', description: 'CHANGED_MIND for beauty products: unopened items only', effect: 'note for the reviewer' },
];

export interface PolicyInput {
  reasonCode: ReasonCode;
  lines: { category: string; qty: number; unitPriceMinor: number }[];
  requestedMinor: number;
  deliveredAt: Date | null;
  carrierStatus: 'NOT_SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'UNKNOWN';
  photos: number;
  buyerHistory: { refunds90d: number; refundRate180d: number };
  capturedMinor: number;
  refundedMinor: number;
  now: Date;
}

const BASE_OUTCOMES: Record<ReasonCode, Resolution[]> = {
  DAMAGED: ['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT'],
  WRONG_ITEM: ['REFUND', 'REPLACEMENT', 'STORE_CREDIT'],
  NOT_AS_DESCRIBED: ['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT'],
  NOT_DELIVERED: ['REFUND', 'REPLACEMENT'],
  CHANGED_MIND: ['REFUND', 'STORE_CREDIT'],
  LATE: ['PARTIAL_REFUND', 'STORE_CREDIT'],
};
const DAY = 86_400_000;
const pick = (m: Record<string, number>, k: string) => m[k] ?? m['*'] ?? 0;

export function daysSince(d: Date | null, now: Date) {
  return d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null;
}

export function evaluatePolicy(input: PolicyInput, riskScore: number, signals: string[] = [], rules: PolicyRules = POLICY_V1): PolicyResult {
  const hits: PolicyResult['ruleHits'] = [];
  const refundableMinor = Math.max(0, input.capturedMinor - input.refundedMinor);
  const days = daysSince(input.deliveredAt, input.now);
  const categories = [...new Set(input.lines.map((l) => l.category))];
  let hardReject = false;
  let forceHuman = false;

  // R1 — return window (not for NOT_DELIVERED / LATE: those are about the shipment, not the item)
  if (input.reasonCode !== 'NOT_DELIVERED' && input.reasonCode !== 'LATE') {
    if (days === null) {
      hardReject = true;
      hits.push({ rule: 'R1', effect: 'REJECT', detail: 'the order has not been delivered — use "not delivered" instead' });
    } else {
      for (const c of categories) {
        const window = pick(rules.returnWindowDays, c);
        if (days <= window) continue;
        const damageWindow = pick(rules.damageWindowDays, c);
        if ((input.reasonCode === 'DAMAGED' || input.reasonCode === 'WRONG_ITEM') && days <= damageWindow) {
          hits.push({ rule: 'R1', effect: 'EXCEPTION', detail: `${c}: ${days} d after delivery, past the ${window}-day window but within ${damageWindow} days for ${input.reasonCode.toLowerCase().replace('_', ' ')}` });
        } else {
          hardReject = true;
          hits.push({ rule: 'R1', effect: 'REJECT', detail: `${c}: requested ${days} d after delivery; the return window is ${window} days` });
        }
      }
    }
  }

  let allowed = [...BASE_OUTCOMES[input.reasonCode]];
  // R4 — perishables
  const perishable = categories.filter((c) => rules.perishable.includes(c));
  if (perishable.length) {
    allowed = allowed.filter((o) => o === 'REPLACEMENT' || o === 'STORE_CREDIT');
    if (!allowed.length) allowed = ['STORE_CREDIT'];
    hits.push({ rule: 'R4', effect: 'RESTRICT', detail: `${perishable.join(', ')}: replacement or store credit only` });
  }
  // R2 — not delivered but the carrier says delivered, no photo
  if (input.reasonCode === 'NOT_DELIVERED' && input.carrierStatus === 'DELIVERED' && input.photos === 0) {
    forceHuman = true;
    hits.push({ rule: 'R2', effect: 'PENDING_HUMAN', detail: 'carrier reports the parcel delivered and there is no photo' });
  }
  // R6 — refund rate
  if (input.buyerHistory.refundRate180d > rules.maxRefundRate180d) {
    forceHuman = true;
    hits.push({ rule: 'R6', effect: 'PENDING_HUMAN', detail: `refund rate ${(input.buyerHistory.refundRate180d * 100).toFixed(0)} % over 180 days (limit ${rules.maxRefundRate180d * 100} %)` });
  }
  // R8 — risk signals
  const riskSignals = signals.filter((s) => s === 'injection_attempt' || s === 'reused_photo');
  if (riskSignals.length) {
    forceHuman = true;
    hits.push({ rule: 'R8', effect: 'PENDING_HUMAN', detail: riskSignals.join(', ') });
  }
  // R9 — changed mind, unopened only
  if (input.reasonCode === 'CHANGED_MIND') {
    const unopened = categories.filter((c) => rules.unopenedOnly.includes(c));
    if (unopened.length) hits.push({ rule: 'R9', effect: 'NOTE', detail: `${unopened.join(', ')}: unopened items only` });
  }
  // R7 — dual control
  const dualControl = input.requestedMinor > rules.dualControlMinor;
  if (dualControl) hits.push({ rule: 'R7', effect: 'DUAL_CONTROL', detail: `amount above ₹${(rules.dualControlMinor / 100).toLocaleString('en-IN')}: support and finance must both approve` });
  if (input.requestedMinor > refundableMinor) hits.push({ rule: 'CAP', effect: 'LIMIT', detail: `requested exceeds the refundable ${refundableMinor}` });

  // R3 — auto-approve envelope
  const r3 =
    input.requestedMinor <= rules.autoMaxMinor && riskScore < rules.maxRisk && input.buyerHistory.refunds90d <= rules.maxRefunds90d && input.requestedMinor <= refundableMinor;
  const autoEligible = !hardReject && !forceHuman && !dualControl && r3;
  if (!hardReject) hits.push({ rule: 'R3', effect: autoEligible ? 'AUTO_ELIGIBLE' : 'NOT_AUTO', detail: autoReason(input, riskScore, rules, refundableMinor) });

  return {
    policyVersion: rules.version,
    hardReject,
    allowedOutcomes: hardReject ? ['REJECT'] : allowed,
    autoEligible,
    requiresHuman: !hardReject && !autoEligible,
    requiredRole: hardReject ? null : 'support',
    dualControl,
    ruleHits: hits,
    refundableMinor,
  };
}

function autoReason(i: PolicyInput, risk: number, r: PolicyRules, refundable: number) {
  const why: string[] = [];
  if (i.requestedMinor > r.autoMaxMinor) why.push(`amount ₹${(i.requestedMinor / 100).toFixed(0)} > ₹${r.autoMaxMinor / 100}`);
  if (risk >= r.maxRisk) why.push(`risk ${risk.toFixed(2)} ≥ ${r.maxRisk}`);
  if (i.buyerHistory.refunds90d > r.maxRefunds90d) why.push(`${i.buyerHistory.refunds90d} refunds in 90 days`);
  if (i.requestedMinor > refundable) why.push('amount above refundable');
  return why.length ? why.join('; ') : 'amount, risk and refund history inside the envelope';
}

/** Returns-local risk heuristic (used until fraud exposes refund scoring). Deterministic, 0..1. */
export function localRisk(i: { requestedMinor: number; reasonCode: ReasonCode; carrierStatus: string; buyerHistory: { refunds90d: number; refundRate180d: number } }, signals: string[]) {
  let r = 0.1;
  if (i.buyerHistory.refundRate180d > 0.3) r += 0.3;
  if (i.buyerHistory.refunds90d > 2) r += 0.15;
  if (i.requestedMinor > 1_000_000) r += 0.15;
  else if (i.requestedMinor > 200_000) r += 0.05;
  if (i.reasonCode === 'NOT_DELIVERED' && i.carrierStatus === 'DELIVERED') r += 0.15;
  if (signals.includes('injection_attempt')) r += 0.25;
  if (signals.includes('reused_photo')) r += 0.3;
  return Math.min(1, Math.round(r * 100) / 100);
}

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /\b(approve|issue|grant)\b.{0,30}\b(full )?refund\b.{0,20}\b(now|immediately|automatically)\b/i,
  /\bsystem prompt\b/i,
  /\byou are (now )?(an?|the) (assistant|ai|agent|admin)/i,
  /\bas (an|the) (admin|administrator|support agent)\b/i,
  /<\/?(system|assistant|tool)>/i,
  /\bdeveloper mode\b|\bjailbreak\b/i,
];
/** Untrusted buyer text is data: flag instruction-like content as a risk signal (never acted on). */
export function textSignals(text: string): string[] {
  return INJECTION.some((re) => re.test(text)) ? ['injection_attempt'] : [];
}
