import type { ReasonCode, Resolution } from '@ac/contracts';
import { looksLikeInjection } from '../prompting.js';
import type { Classification, ClassifyInput, ProposalDraft, ProposeInput, RefundModel } from '../models.js';

/**
 * OFFLINE refund model — deterministic, documented heuristics with the same structured outputs the OpenAI provider
 * returns. Used when no OPENAI_API_KEY is configured (dev, CI, evals). It is NOT a substitute for a real model on
 * free text: it only knows the phrases below (English, common Hinglish, a few typos). Eval numbers produced with it
 * measure the graph + policy + guardrails, not language understanding (docs/03 §3.8 as-built).
 *
 * classify: keyword lexicon per reason (negation-aware for "damaged"/"broken"), priority on ties
 *   NOT_DELIVERED > WRONG_ITEM > DAMAGED > NOT_AS_DESCRIBED > LATE > CHANGED_MIND; the stated code wins whenever the
 *   text supports it at least as strongly as any other reason.
 * propose: the best outcome allowed by the policy (LATE → partial refund of 10 %, min ₹50; preferred replacement
 *   if allowed; else refund; else store credit; else replacement), amount capped at requested and refundable;
 *   confidence 0.92 minus penalties (reason mismatch, missing photo, injection, risk ≥ 0.3, weak classification).
 */
const LEXICON: Record<ReasonCode, RegExp[]> = {
  NOT_DELIVERED: [
    /\bnot (yet )?(been )?(delivered|received)\b/, /\bnever (arrived|came|received|got|reached)\b/, /\bdid ?n[o']?t (get|receive|arrive|reach)\b/,
    /\bhave ?n[o']?t (got|gotten|received)\b/, /\bno (parcel|package|delivery)\b/, /\b(nahi|nhi|nahin) (mila|aaya|aya|pahuncha|pohcha)\b/,
    /\bmarked (as )?delivered\b/, /\b(parcel|package|order) (is )?missing\b/, /\bstill waiting\b/, /\bwhere is my (order|parcel|package)\b/,
  ],
  WRONG_ITEM: [
    /\bwrong (item|product|thing|model|book|size sent|colou?r sent)\b/, /\bsent (me )?(the |a )?wrong\b/, /\bdifferent (item|product|thing)\b/,
    /\bnot what i ordered\b/, /\binstead of\b/, /\bgalat (item|product|saman|samaan|cheez)\b/, /\bsomeone else'?s order\b/, /\bdusra (item|product|saman)\b/,
  ],
  DAMAGED: [
    /\b(broken|damaged|damage|cracked|crack|shattered|smashed|dented|dent|torn|ripped|leak(ing|ed)?|spilt|spilled|scratched|scratches|crushed)\b/,
    /\bdamg?a?ed\b|\bdamgaed\b|\bbrokn\b/, /\btoot(a|i)?( gaya| gayi| hua| hui)?\b/, /\btut(a|i)( hua| hui)?\b/, /\bphat(a|i)( hua| hui| gaya)?\b/,
    /\bnot working\b|\bdoes ?n[o']?t work\b|\bstopped working\b|\bdead on arrival\b|\bdefective\b|\bkharab\b/,
  ],
  NOT_AS_DESCRIBED: [
    /\bnot as (described|shown|pictured|advertised)\b/, /\bdoes ?n[o']?t match (the )?(description|photo|picture|listing|images?)\b/,
    /\bdifferent (colou?r|size|shade|material|fabric)\b/, /\b(fake|duplicate|counterfeit|first copy|not original|knock ?off)\b/,
    /\b(poor|cheap|bad|low) quality\b/, /\b(much )?smaller than\b|\bsize (is )?(wrong|too small|too big)\b/, /\bcolou?r (is )?(different|wrong)\b/,
  ],
  LATE: [/\b(very |too |so )?late\b/, /\bdelay(ed)?\b/, /\btook (too long|\d+ (days|weeks))\b/, /\bafter the (promised|expected|delivery) date\b/, /\b(bahut )?der se\b/, /\barrived after\b/],
  CHANGED_MIND: [
    /\bchanged my mind\b/, /\b(do ?n[o']?t|do not|no longer) (need|want|require)\b/, /\bnot needed\b/, /\b(ordered|bought) (it )?by mistake\b/, /\bby mistake\b/,
    /\bpasand nahi\b/, /\bnahi chahiye\b/, /\bfound (it )?cheaper\b/, /\bno longer required\b/,
  ],
};
const PRIORITY: ReasonCode[] = ['NOT_DELIVERED', 'WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED', 'LATE', 'CHANGED_MIND'];
const NEGATED_DAMAGE = /\b(not|no|isn'?t|wasn'?t|without|nothing|nahi|nhi)\b( \w+){0,2} (broken|damaged|damage|cracked|scratched|leaking|torn)\b/;
const PHOTO = /\b(photo|photos|picture|pic|pics|image|images|attached|screenshot|video)\b/;

const REASON_TEXT: Record<ReasonCode, string> = {
  DAMAGED: 'the item arrived damaged or defective',
  WRONG_ITEM: 'a different item was delivered',
  NOT_AS_DESCRIBED: 'the item does not match its description',
  NOT_DELIVERED: 'the order was not received',
  CHANGED_MIND: 'they no longer want the item',
  LATE: 'the order arrived late',
};

export function scoreReasons(text: string): Record<ReasonCode, number> {
  const t = ` ${text.toLowerCase().replace(/[​-‏﻿]/g, '').replace(/[^a-z0-9'₹ ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const out = {} as Record<ReasonCode, number>;
  for (const r of PRIORITY) out[r] = LEXICON[r].filter((re) => re.test(t)).length;
  // "not damaged, just the wrong colour" → the damage words are negated
  if (out.DAMAGED && NEGATED_DAMAGE.test(t)) out.DAMAGED = Math.max(0, out.DAMAGED - 1);
  // "arrived late and broken" — LATE is secondary when a product problem is present
  if (out.LATE && (out.DAMAGED || out.WRONG_ITEM || out.NOT_AS_DESCRIBED)) out.LATE = 0;
  // "marked delivered but never got it" is NOT_DELIVERED even though "delivered" appears
  return out;
}

export function classifyOffline(input: ClassifyInput): Classification {
  const scores = scoreReasons(input.buyerText);
  const best = PRIORITY.reduce((a, r) => (scores[r] > scores[a] ? r : a), PRIORITY[0]);
  const bestScore = scores[best];
  const stated = scores[input.statedReason];
  let reasonCode = input.statedReason;
  let reasonConfidence = 0.7;
  let mismatch = false;
  if (bestScore === 0) reasonConfidence = 0.7;
  else if (stated >= bestScore) reasonConfidence = 0.95;
  else {
    reasonCode = best;
    mismatch = true;
    reasonConfidence = bestScore >= 2 ? 0.85 : 0.75;
  }
  return {
    reasonCode,
    reasonConfidence,
    mismatch,
    injection: looksLikeInjection(input.buyerText),
    mentionsPhoto: PHOTO.test(input.buyerText.toLowerCase()),
    summary: `Buyer reports that ${REASON_TEXT[reasonCode]}${mismatch ? ` (stated reason was ${input.statedReason})` : ''}.`,
  };
}

const rupees = (minor: number, currency: string) => `${currency === 'INR' ? '₹' : `${currency} `}${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function proposeOffline(input: ProposeInput): ProposalDraft {
  const { policy, currency } = input;
  const cap = Math.max(0, Math.min(input.requestedMinor, input.refundableMinor));
  if (policy.hardReject) {
    const rule = policy.ruleHits.find((h) => h.effect.toLowerCase().includes('reject'));
    return {
      outcome: 'REJECT',
      amountMinor: 0,
      confidence: 0.95,
      summary: `Policy ${policy.policyVersion} hard-rejects this request${rule ? ` (${rule.rule}: ${rule.detail})` : ''}.`,
      buyerExplanation: `We could not accept this return: ${rule?.detail ?? 'it is outside our return policy'}. You can appeal if you think this is a mistake.`,
    };
  }
  const allowed = new Set<Resolution>(policy.allowedOutcomes);
  let outcome: Resolution = 'REJECT';
  let amountMinor = 0;
  if (input.reasonCode === 'LATE' && allowed.has('PARTIAL_REFUND')) {
    outcome = 'PARTIAL_REFUND';
    amountMinor = Math.min(Math.max(5000, Math.round(input.requestedMinor * 0.1)), cap);
  } else if (input.preferred === 'REPLACEMENT' && allowed.has('REPLACEMENT')) outcome = 'REPLACEMENT';
  else if (allowed.has('REFUND')) [outcome, amountMinor] = ['REFUND', cap];
  else if (allowed.has('STORE_CREDIT')) [outcome, amountMinor] = ['STORE_CREDIT', cap];
  else if (allowed.has('REPLACEMENT')) outcome = 'REPLACEMENT';
  else if (allowed.has('PARTIAL_REFUND')) [outcome, amountMinor] = ['PARTIAL_REFUND', Math.min(Math.max(5000, Math.round(input.requestedMinor * 0.1)), cap)];

  const c = input.classification;
  let confidence = 0.92;
  if (c.mismatch) confidence -= 0.15;
  if (input.signals.includes('needs_photo')) confidence -= 0.2;
  if (c.injection) confidence -= 0.3;
  if (input.riskScore >= 0.3) confidence -= 0.1;
  if (c.reasonConfidence < 0.8) confidence -= 0.05;
  confidence = Math.round(Math.min(0.99, Math.max(0.05, confidence)) * 100) / 100;

  const what: Record<Resolution, string> = {
    REFUND: `a refund of ${rupees(amountMinor, currency)} to the original payment method`,
    PARTIAL_REFUND: `a partial refund of ${rupees(amountMinor, currency)} for the inconvenience`,
    REPLACEMENT: 'a replacement of the item',
    STORE_CREDIT: `store credit of ${rupees(amountMinor, currency)}`,
    REJECT: 'no resolution within policy',
  };
  return {
    outcome,
    amountMinor,
    confidence,
    summary: `${c.summary} Policy ${policy.policyVersion} allows ${[...allowed].join(', ') || 'nothing'}; proposing ${outcome}${amountMinor ? ` of ${amountMinor} minor units` : ''}.`,
    buyerExplanation: outcome === 'REJECT' ? 'Our team will review your request and get back to you.' : `We are reviewing your request for ${what[outcome]}. We will confirm the outcome shortly.`,
  };
}

export const offlineRefundModel: RefundModel = {
  provider: 'offline',
  name: 'offline-heuristics-v1',
  async classify(input, meter) {
    const startedAt = new Date();
    const result = classifyOffline(input);
    meter({ input: 0, output: 0, model: 'offline-heuristics-v1', task: 'classify', startedAt, prompt: { statedReason: input.statedReason }, result });
    return result;
  },
  async propose(input, meter) {
    const startedAt = new Date();
    const result = proposeOffline(input);
    meter({ input: 0, output: 0, model: 'offline-heuristics-v1', task: 'propose', startedAt, prompt: { allowed: input.policy.allowedOutcomes }, result });
    return result;
  },
};
