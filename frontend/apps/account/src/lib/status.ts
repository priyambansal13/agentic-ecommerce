import type { Tone } from '@ac/ui';

export const orderTone = (s: string): Tone => (s === 'DELIVERED' ? 'good' : s === 'CANCELLED' ? 'critical' : s === 'PENDING_PAYMENT' || s === 'RETURN_IN_PROGRESS' ? 'warning' : 'neutral');
export const refundTone = (s: string): Tone =>
  s === 'REFUNDED' || s === 'AUTO_APPROVED' || s === 'APPROVED' ? 'good' : s === 'REJECTED' ? 'critical' : s === 'PENDING_HUMAN' || s === 'AWAITING_BUYER' ? 'warning' : 'neutral';
export const label = (s: string) => s.toLowerCase().replaceAll('_', ' ');
