import type { CaseContext, PolicyResult, ReasonCode, Resolution } from '@ac/contracts';

/**
 * REFERENCE refund policy v1 — used ONLY by the offline evals (fake returns service) and the dataset generator.
 * It mirrors the decision table in platform/docs/02-lld.md §2.7 (R0–R6). The real, authoritative implementation lives
 * in the returns service (owned there; no cross-service imports). If the two diverge, evals still measure the agent
 * (graph + model + guardrails) against THIS table; parity with returns is checked by the live verification, not here.
 */
export const REF_POLICY_VERSION = 'v1';
export const RETURN_WINDOW_DAYS: Record<string, number> = { grocery: 7, beauty: 7, electronics: 10, books: 10, jewellery: 15, fashion: 30, home: 30, outdoor: 30 };
export const AUTO_MAX_MINOR = 200_000; // ₹2,000
export const DUAL_CONTROL_MINOR = 2_500_000; // ₹25,000
export const MAX_RISK = 0.3;
const DAY = 86_400_000;

export function effectiveReason(ctx: CaseContext, signals: string[]): ReasonCode {
  const r = signals.find((s) => s.startsWith('reclassified:'))?.split(':')[1];
  return (r as ReasonCode) ?? ctx.claim.reasonCode;
}

export function referencePolicy(ctx: CaseContext, riskScore: number, signals: string[], now: Date): PolicyResult {
  const hits: PolicyResult['ruleHits'] = [];
  const reason = effectiveReason(ctx, signals);
  const category = ctx.claim.lines[0]?.category ?? 'other';
  const window = Math.min(...ctx.claim.lines.map((l) => RETURN_WINDOW_DAYS[l.category] ?? 30));
  const refundable = Math.max(0, ctx.order.capturedMinor - ctx.order.refundedMinor);
  const hasPhoto = ctx.evidence.some((e) => e.kind === 'PHOTO');
  let hardReject = false;
  let humanOnly = false;

  if (refundable <= 0) {
    hardReject = true;
    hits.push({ rule: 'R0', effect: 'REJECT', detail: 'nothing left to refund on this order' });
  }
  if (reason !== 'NOT_DELIVERED' && reason !== 'LATE') {
    if (!ctx.order.deliveredAt) {
      hardReject = true;
      hits.push({ rule: 'R1', effect: 'REJECT', detail: 'the order has not been delivered yet' });
    } else {
      const days = (now.getTime() - new Date(ctx.order.deliveredAt).getTime()) / DAY;
      if (days > window) {
        if (reason === 'DAMAGED' && days <= 30) hits.push({ rule: 'R1', effect: 'ALLOW', detail: `damage reported ${Math.floor(days)} days after delivery (≤ 30 days)` });
        else {
          hardReject = true;
          hits.push({ rule: 'R1', effect: 'REJECT', detail: `outside the ${window}-day return window for ${category}` });
        }
      }
    }
  }
  if (reason === 'NOT_DELIVERED' && ctx.tracking.carrierStatus === 'DELIVERED' && !hasPhoto) {
    humanOnly = true;
    hits.push({ rule: 'R2', effect: 'PENDING_HUMAN', detail: 'carrier reports delivered' });
  }

  let allowed: Resolution[];
  const perishable = ctx.claim.lines.some((l) => l.category === 'grocery' || l.category === 'beauty');
  if (perishable) {
    hits.push({ rule: 'R4', effect: 'LIMIT', detail: 'grocery/beauty: replacement or store credit only' });
    allowed = ['REPLACEMENT', 'STORE_CREDIT'];
    if (reason === 'CHANGED_MIND') {
      hardReject = true;
      hits.push({ rule: 'R4', effect: 'REJECT', detail: 'change-of-mind returns are not accepted for grocery/beauty' });
    }
    if (reason === 'LATE') allowed = ['STORE_CREDIT'];
  } else
    allowed = ({
      DAMAGED: ['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT'],
      WRONG_ITEM: ['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT'],
      NOT_AS_DESCRIBED: ['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT'],
      NOT_DELIVERED: ['REFUND', 'REPLACEMENT'],
      LATE: ['PARTIAL_REFUND', 'STORE_CREDIT'],
      CHANGED_MIND: ['REFUND', 'STORE_CREDIT'],
    } as Record<ReasonCode, Resolution[]>)[reason];

  if (ctx.buyerHistory.refundRate180d > 0.3) {
    humanOnly = true;
    hits.push({ rule: 'R6', effect: 'PENDING_HUMAN', detail: 'buyer refund rate above 30 % (180 days)' });
  }
  const blockingSignals = signals.filter((s) => s === 'injection_attempt' || s === 'needs_photo' || s === 'reason_mismatch');
  if (blockingSignals.length) hits.push({ rule: 'S', effect: 'PENDING_HUMAN', detail: `signals: ${blockingSignals.join(', ')}` });
  const r3 = ctx.requestedMinor <= AUTO_MAX_MINOR && riskScore < MAX_RISK && ctx.buyerHistory.refunds90d <= 2;
  if (r3) hits.push({ rule: 'R3', effect: 'AUTO_ELIGIBLE', detail: 'small amount, low risk, few recent refunds' });
  const dualControl = ctx.requestedMinor > DUAL_CONTROL_MINOR;
  if (dualControl) hits.push({ rule: 'R7', effect: 'DUAL_CONTROL', detail: 'above ₹25,000: support + finance' });
  const autoEligible = !hardReject && !humanOnly && r3 && !blockingSignals.length && !dualControl;

  return {
    policyVersion: REF_POLICY_VERSION,
    hardReject,
    allowedOutcomes: hardReject ? [] : allowed,
    autoEligible,
    requiresHuman: !hardReject && !autoEligible,
    requiredRole: hardReject || autoEligible ? null : dualControl ? 'finance' : 'support',
    dualControl,
    ruleHits: hits,
    refundableMinor: refundable,
  };
}

/** The ideal agent decision under the reference table (dataset labels). Mirrors the documented decision rules. */
export function idealOutcome(policy: PolicyResult, reason: ReasonCode, preferred: 'REFUND' | 'REPLACEMENT', requestedMinor: number): { outcome: Resolution; amountMin: number; amountMax: number } {
  const cap = Math.max(0, Math.min(requestedMinor, policy.refundableMinor));
  if (policy.hardReject) return { outcome: 'REJECT', amountMin: 0, amountMax: 0 };
  const a = new Set(policy.allowedOutcomes);
  const partial = () => {
    const lo = Math.min(cap, Math.max(5000, Math.round(requestedMinor * 0.05)));
    const hi = Math.min(cap, Math.max(5000, Math.round(requestedMinor * 0.2)));
    return { outcome: 'PARTIAL_REFUND' as const, amountMin: lo, amountMax: hi };
  };
  if (reason === 'LATE' && a.has('PARTIAL_REFUND')) return partial();
  if (preferred === 'REPLACEMENT' && a.has('REPLACEMENT')) return { outcome: 'REPLACEMENT', amountMin: 0, amountMax: 0 };
  if (a.has('REFUND')) return { outcome: 'REFUND', amountMin: cap, amountMax: cap };
  if (a.has('STORE_CREDIT')) return { outcome: 'STORE_CREDIT', amountMin: cap, amountMax: cap };
  if (a.has('REPLACEMENT')) return { outcome: 'REPLACEMENT', amountMin: 0, amountMax: 0 };
  if (a.has('PARTIAL_REFUND')) return partial();
  return { outcome: 'REJECT', amountMin: 0, amountMax: 0 };
}
