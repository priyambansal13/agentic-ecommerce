import { CaseContextSchema, PolicyResultSchema, ProposalInputSchema, RiskResultSchema } from '@ac/contracts';
import { z } from 'zod';
import type { DomainPort } from '../../runtime/domain.js';
import { defineTool, type ToolCallContext } from '../define-tool.js';

/**
 * Refund agent tools (docs/03 A1). Tier → requirement:
 *  READ             getCaseContext, scoreRisk, evaluatePolicy — allow-listed in OPA data
 *  WRITE_REVERSIBLE requestBuyerEvidence (L3+), submitProposal (SHADOW/RECOMMEND from L1, LIVE only at L3+)
 *  MONEY            executeRefund — OPA envelope over SERVER-derived facts (case status, refundable, fresh risk,
 *                   policy result) — never over model-provided values; returns re-checks on its side too.
 */
const domain = (ctx: ToolCallContext): DomainPort => {
  if (!ctx.domain) throw new Error('no domain port in run context');
  return ctx.domain;
};
const Status = z.object({ status: z.string() }).loose();

export const getCaseContext = defineTool({
  name: 'getCaseContext',
  description: 'Load the refund case: claim, order snapshot (city/pincode only), tracking, buyer refund history, evidence.',
  tier: 'READ',
  agents: ['refund'],
  input: z.object({ caseId: z.uuid() }),
  output: CaseContextSchema,
  handler: (ctx, a) => domain(ctx).getCaseContext(a.caseId),
});

export const scoreRisk = defineTool({
  name: 'scoreRisk',
  description: 'Score refund risk for the case (fraud service; buyer identity comes from the trigger, not from the model).',
  tier: 'READ',
  agents: ['refund'],
  input: z.object({ caseId: z.uuid(), orderId: z.uuid(), requestedMinor: z.int().min(0), totalMinor: z.int().min(0), pincode: z.string().nullable(), sellerId: z.uuid(), signals: z.array(z.string()) }),
  output: RiskResultSchema,
  handler: (ctx, a) => domain(ctx).scoreRisk({ ...a, buyerId: ctx.facts?.buyerId ?? null }),
});

export const evaluatePolicy = defineTool({
  name: 'evaluatePolicy',
  description: 'Deterministic refund policy (decision table): allowed outcomes, hard rejects, auto envelope, dual control.',
  tier: 'READ',
  agents: ['refund'],
  input: z.object({ caseId: z.uuid(), riskScore: z.number().min(0).max(1), signals: z.array(z.string()) }),
  output: PolicyResultSchema,
  handler: (ctx, a) => domain(ctx).evaluatePolicy(a.caseId, { riskScore: a.riskScore, signals: a.signals }),
});

export const requestBuyerEvidence = defineTool({
  name: 'requestBuyerEvidence',
  description: 'Ask the buyer for a photo of the problem (sets the case to AWAITING_BUYER).',
  tier: 'WRITE_REVERSIBLE',
  scope: 'refunds:propose',
  agents: ['refund'],
  input: z.object({ caseId: z.uuid(), message: z.string().max(300) }),
  output: Status,
  handler: (ctx, a) => domain(ctx).requestEvidence(a.caseId, { kind: 'PHOTO', message: a.message, runId: ctx.runId }, ctx.idempotencyKey),
});

export const submitProposal = defineTool({
  name: 'submitProposal',
  description: 'Store the agent proposal on the case. SHADOW = stored only (L1), RECOMMEND = shown to support (L2), LIVE = may auto-approve (L3).',
  tier: 'WRITE_REVERSIBLE',
  scope: 'refunds:propose',
  agents: ['refund'],
  input: ProposalInputSchema.extend({ caseId: z.uuid() }),
  output: z.object({ status: z.string(), valid: z.boolean().optional(), violations: z.array(z.string()).optional() }),
  // OPA: SHADOW/RECOMMEND only store data → allowed from L1; LIVE needs L3 (rule in tools.rego)
  opaContext: async (_ctx, a) => ({ proposal: { mode: a.mode } }),
  handler: (ctx, { caseId, ...body }) => domain(ctx).submitProposal(caseId, body, ctx.idempotencyKey),
});

export const executeRefund = defineTool({
  name: 'executeRefund',
  description: 'Execute an auto-approved refund through the returns service (payment refund). MONEY tier.',
  tier: 'MONEY',
  scope: 'refunds:execute:auto',
  agents: ['refund'],
  input: z.object({ caseId: z.uuid(), amountMinor: z.int().min(0), outcome: z.enum(['REFUND', 'PARTIAL_REFUND', 'STORE_CREDIT', 'REPLACEMENT', 'REJECT']) }),
  output: z.object({ status: z.string(), refundId: z.string().nullable().optional() }).loose(),
  /** Server-side facts only: fresh case status + refundable, fresh risk, fresh policy result. */
  opaContext: async (ctx, a) => {
    const d = domain(ctx);
    const c = await d.getCaseContext(a.caseId);
    const risk = await d.scoreRisk({ caseId: a.caseId, orderId: c.order.orderId, buyerId: ctx.facts?.buyerId ?? null, totalMinor: c.order.totalMinor, requestedMinor: c.requestedMinor, pincode: c.order.pincode, sellerId: c.order.sellerId, signals: [] });
    const policy = await d.evaluatePolicy(a.caseId, { riskScore: risk.score, signals: (ctx.facts?.signals ?? '').split(',').filter(Boolean) });
    return {
      case: {
        status: c.status,
        policy_outcome: policy.allowedOutcomes.includes(a.outcome) ? a.outcome : 'NOT_ALLOWED',
        risk_score: risk.score,
        auto_eligible: policy.autoEligible && !policy.hardReject && !policy.dualControl,
        requested_minor: c.requestedMinor,
      },
      order: { currency: c.currency, refundable_minor: Math.max(0, c.order.capturedMinor - c.order.refundedMinor) },
      approvals: [],
    };
  },
  handler: (ctx, a) => domain(ctx).executeRefund(a.caseId, { amountMinor: a.amountMinor, runId: ctx.runId }, ctx.idempotencyKey),
});

export const REFUND_TOOLS = [getCaseContext, scoreRisk, evaluatePolicy, requestBuyerEvidence, submitProposal, executeRefund];
