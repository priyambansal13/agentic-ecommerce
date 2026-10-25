import type { ReasonCode } from '@ac/contracts';
import type { Tone } from '@ac/ui';

/** Client-safe return copy and helpers (no server imports — used by client components too). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain-language reasons (buyer never sees the internal codes). */
export const REASONS: { code: ReasonCode; label: string; hint: string; photo: boolean }[] = [
  { code: 'DAMAGED', label: 'Item arrived damaged or defective', hint: 'A photo of the damage helps us decide faster.', photo: true },
  { code: 'WRONG_ITEM', label: 'I received the wrong item', hint: 'A photo of what you received helps us decide faster.', photo: true },
  { code: 'NOT_AS_DESCRIBED', label: 'Item is different from its description', hint: 'Tell us what is different; a photo helps.', photo: true },
  { code: 'NOT_DELIVERED', label: 'My package never arrived', hint: 'We check the carrier’s tracking for you.', photo: false },
  { code: 'LATE', label: 'It arrived too late to be useful', hint: 'Tell us when you needed it.', photo: false },
  { code: 'CHANGED_MIND', label: 'I no longer need it', hint: 'Unused items in original packaging, within the return window.', photo: false },
];
export const reasonLabel = (c: string) => REASONS.find((r) => r.code === c)?.label ?? 'Other';

/** Buyer-facing status (the API also sends `statusText`; this is the fallback and the badge tone). */
export const RETURN_STATUS: Record<string, { text: string; tone: Tone }> = {
  REQUESTED: { text: 'Return requested', tone: 'neutral' },
  GATHERING_EVIDENCE: { text: 'Under review', tone: 'neutral' },
  AWAITING_BUYER: { text: 'We need a photo from you', tone: 'warning' },
  PROPOSED: { text: 'Under review', tone: 'neutral' },
  PENDING_HUMAN: { text: 'Under review by our team', tone: 'neutral' },
  AUTO_APPROVED: { text: 'Approved', tone: 'good' },
  APPROVED: { text: 'Approved', tone: 'good' },
  REFUND_PENDING: { text: 'Refund on its way', tone: 'good' },
  REFUNDED: { text: 'Refund issued', tone: 'good' },
  FAILED: { text: 'Refund delayed — we are on it', tone: 'warning' },
  REJECTED: { text: 'Not approved', tone: 'critical' },
  APPEALED: { text: 'Appeal under review', tone: 'warning' },
  CLOSED: { text: 'Closed', tone: 'neutral' },
};
export const statusOf = (s: string) => RETURN_STATUS[s] ?? { text: s.toLowerCase().replaceAll('_', ' '), tone: 'neutral' as Tone };

/** Friendly copy for ReturnRejection codes. */
export const REJECTION_TEXT: Record<string, string> = {
  NOT_OWNER: 'We couldn’t find this order in your account.',
  ORDER_NOT_ELIGIBLE: 'This order can’t be returned yet — returns open once it has been delivered (or shipped, for a missing package).',
  OUTSIDE_WINDOW: 'The return window for this order has closed. If the item arrived damaged, choose “damaged or defective” — those are accepted for longer.',
  ALREADY_OPEN: 'You already have a return open for this order. You can follow it under Returns & refunds.',
  QTY_EXCEEDS_ORDERED: 'You chose more items than you ordered.',
};
