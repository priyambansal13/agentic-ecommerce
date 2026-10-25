import type { CaseStatus, Resolution } from '@ac/contracts';

/** Refund case state machine (LLD §2.7). Every transition is checked here and versioned in the repository. */
export const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  REQUESTED: ['GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'PENDING_HUMAN', 'REJECTED'],
  GATHERING_EVIDENCE: ['AWAITING_BUYER', 'PROPOSED', 'PENDING_HUMAN', 'REJECTED'],
  AWAITING_BUYER: ['GATHERING_EVIDENCE', 'PENDING_HUMAN', 'CLOSED'],
  PROPOSED: ['AUTO_APPROVED', 'PENDING_HUMAN', 'REJECTED'],
  // a LIVE agent proposal may still auto-approve a case nobody has touched yet (see proposal())
  PENDING_HUMAN: ['APPROVED', 'REJECTED', 'AUTO_APPROVED', 'AWAITING_BUYER', 'CLOSED'],
  AUTO_APPROVED: ['REFUND_PENDING', 'CLOSED'],
  APPROVED: ['REFUND_PENDING', 'CLOSED'],
  REFUND_PENDING: ['REFUNDED', 'FAILED'],
  FAILED: ['REFUND_PENDING', 'PENDING_HUMAN'],
  REJECTED: ['APPEALED'],
  APPEALED: ['PENDING_HUMAN'],
  REFUNDED: [],
  CLOSED: [],
};

export class TransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`case cannot go from ${from} to ${to}`);
  }
}
export function assertTransition(from: CaseStatus, to: CaseStatus) {
  if (!TRANSITIONS[from]?.includes(to)) throw new TransitionError(from, to);
}

export const OPEN_STATUSES: CaseStatus[] = ['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'AUTO_APPROVED', 'PENDING_HUMAN', 'APPROVED', 'REFUND_PENDING', 'FAILED', 'APPEALED'];
/** statuses whose items count as "already returned" for the qty check */
export const COUNTS_AS_RETURNED: CaseStatus[] = [...OPEN_STATUSES, 'REFUNDED'];

export const STATUS_TEXT: Record<CaseStatus, string> = {
  REQUESTED: 'Return requested',
  GATHERING_EVIDENCE: 'We are reviewing your request',
  AWAITING_BUYER: 'We need a photo from you',
  PROPOSED: 'We are reviewing your request',
  AUTO_APPROVED: 'Approved — refund on its way',
  PENDING_HUMAN: 'Our team is reviewing your request',
  APPROVED: 'Approved — refund on its way',
  REJECTED: 'Not approved',
  REFUND_PENDING: 'Refund being processed',
  REFUNDED: 'Refund issued',
  FAILED: 'Refund delayed — our team is on it',
  APPEALED: 'Appeal under review',
  CLOSED: 'Closed',
};

/** outcomes that move money through payment; others close the case (wallet / replacement orders not built yet) */
export const MONEY_OUTCOMES: Resolution[] = ['REFUND', 'PARTIAL_REFUND'];

export type Approver = { sub: string; roles: string[] };
export type ApprovalCase = {
  status: CaseStatus;
  requiredRole: 'support' | 'finance' | null;
  dualControl: boolean;
  firstApprover: string | null;
};
export type ApprovalStep =
  | { kind: 'first'; nextRole: 'finance' } // dual control: support approved, finance must approve next
  | { kind: 'final' };

export class ApprovalError extends Error {
  constructor(readonly status: 403 | 409 | 422, message: string) {
    super(message);
  }
}

/**
 * Who may approve now, and does this approval finish the case? Dual control (amount above the threshold):
 * support (or admin acting as support) first, then finance (or admin) — never the same person twice.
 */
export function approvalStep(c: ApprovalCase, who: Approver, amountMinor: number, dualControlMinor: number): ApprovalStep {
  if (c.status !== 'PENDING_HUMAN') throw new ApprovalError(409, `case is ${c.status}, not waiting for a decision`);
  const dual = c.dualControl || amountMinor > dualControlMinor;
  const role = c.requiredRole ?? 'support';
  const isAdmin = who.roles.includes('admin');
  if (!who.roles.includes(role) && !isAdmin) throw new ApprovalError(403, `this step needs the ${role} role`);
  if (c.firstApprover && c.firstApprover === who.sub) throw new ApprovalError(403, 'dual control: a second, different person must approve');
  if (dual && role === 'support') return { kind: 'first', nextRole: 'finance' };
  return { kind: 'final' };
}

/** Refund cap: never above the approved amount nor the order's refundable amount (captured − refunded). */
export function assertRefundable(amountMinor: number, approvedMinor: number | null, refundableMinor: number) {
  if (amountMinor <= 0) throw new ApprovalError(422, 'amount must be positive');
  if (approvedMinor !== null && amountMinor > approvedMinor) throw new ApprovalError(422, `amount exceeds the approved ${approvedMinor}`);
  if (amountMinor > refundableMinor) throw new ApprovalError(422, `amount exceeds the refundable ${refundableMinor}`);
}

/** Execute is idempotent per case: an already executed (or executing) case returns its existing result. */
export function executeDecision(status: CaseStatus): 'execute' | 'already' | 'refuse' {
  if (status === 'AUTO_APPROVED' || status === 'APPROVED' || status === 'FAILED') return 'execute';
  if (status === 'REFUND_PENDING' || status === 'REFUNDED') return 'already';
  return 'refuse';
}
