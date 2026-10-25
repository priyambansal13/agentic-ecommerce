import type { Tone } from '@ac/ui';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OUTCOME: Record<string, string> = {
  REFUND: 'Full refund',
  PARTIAL_REFUND: 'Partial refund',
  REPLACEMENT: 'Replacement',
  STORE_CREDIT: 'Store credit',
  REJECT: 'Reject',
};
export const REASON: Record<string, string> = {
  DAMAGED: 'Damaged / defective',
  WRONG_ITEM: 'Wrong item',
  NOT_AS_DESCRIBED: 'Not as described',
  NOT_DELIVERED: 'Not delivered',
  CHANGED_MIND: 'Changed mind',
  LATE: 'Arrived late',
};
export const caseTone = (s: string): Tone =>
  ['REFUNDED', 'APPROVED', 'AUTO_APPROVED', 'REFUND_PENDING'].includes(s) ? 'good' : ['REJECTED', 'FAILED'].includes(s) ? 'critical' : ['PENDING_HUMAN', 'APPEALED', 'AWAITING_BUYER'].includes(s) ? 'warning' : 'neutral';
export const caseLabel = (s: string) => s.toLowerCase().replaceAll('_', ' ');
export const riskTone = (r: number | null): Tone => (r === null ? 'neutral' : r >= 0.6 ? 'critical' : r >= 0.3 ? 'warning' : 'good');
/** Cases a person can still decide. */
export const OPEN = ['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'PENDING_HUMAN', 'APPEALED'];
/** Autonomy levels (docs 03 §3.3). */
export const LEVELS = [
  { level: 0, name: 'Off', text: 'Agent disabled — people handle everything.' },
  { level: 1, name: 'Shadow', text: 'Runs on real cases; proposals are stored but never shown or acted on.' },
  { level: 2, name: 'Recommend', text: 'Proposals are shown to support, who decide.' },
  { level: 3, name: 'Bounded auto', text: 'Executes refunds inside the policy envelope; everything else goes to a person.' },
  { level: 4, name: 'Auto + audit', text: 'Executes; a sample is reviewed by people afterwards.' },
];
