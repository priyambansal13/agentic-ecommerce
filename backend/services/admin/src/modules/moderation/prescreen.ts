/**
 * Deterministic listing pre-screen — stands in for the moderation agent until it ships (services/agents).
 * The listing text is untrusted data: it is only pattern-matched, never interpreted as instructions.
 * Only a confident APPROVE is auto-decided; everything else waits for a human moderator.
 */
export interface Prescreen { verdict: 'APPROVE' | 'NEEDS_REVIEW' | 'REJECT'; confidence: number; reasons: string[] }

const COUNTERFEIT = /\b(replica|first[- ]copy|fake|counterfeit|duplicate of|inspired by)\b/i;
const CLAIMS = /\b(cures?|guaranteed (weight loss|results)|miracle|100% safe|clinically proven|no side effects)\b/i;
const CONTACT = /(\+91[\s-]?)?[6-9]\d{9}\b|https?:\/\/|www\.|whatsapp/i;

export const AUTO_APPROVE_CONFIDENCE = 0.9;

export function prescreen(l: { title: string; description: string; bullets: string[] }): Prescreen {
  const text = `${l.title}\n${l.description}\n${l.bullets.join('\n')}`;
  const hard: string[] = [];
  const soft: string[] = [];
  if (COUNTERFEIT.test(text)) hard.push('counterfeit wording (replica / first copy / fake)');
  if (CLAIMS.test(text)) soft.push('medical or guaranteed-result claim');
  if (CONTACT.test(text)) soft.push('contact details or links in listing text');
  if (l.title.length < 10) soft.push('title too short');
  if (l.title.length > 0 && l.title === l.title.toUpperCase() && /[A-Z]{4}/.test(l.title)) soft.push('title in capital letters');
  if (l.description.trim().length < 60) soft.push('description under 60 characters');
  if (l.bullets.length < 2) soft.push('fewer than 2 bullet points');
  if (hard.length) return { verdict: 'REJECT', confidence: 0.85, reasons: [...hard, ...soft] };
  const confidence = Math.max(0.4, Math.round((0.97 - soft.length * 0.12) * 100) / 100);
  return { verdict: soft.length ? 'NEEDS_REVIEW' : 'APPROVE', confidence, reasons: soft };
}
