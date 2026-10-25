/**
 * P3: returns & refunds (the deterministic backbone of the governed Refund Agent) + agent governance surfaces.
 * Contracts 0.7.0 — additive. Design: platform/docs/02-lld.md §2.7, 03-agentic-ai.md §3.3 + A1.
 * [returns] /api/returns/v1/…  ·  [agents] /api/agents/v1/…  · internal endpoints need realm role `service`
 * (or an agent token obtained by token exchange: `act.sub = agent:<id>`, scopes below).
 */
import { z } from 'zod';

const Minor = z.int();
const IsoDate = z.iso.datetime();

export const ReasonCode = z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NOT_DELIVERED', 'CHANGED_MIND', 'LATE']);
export type ReasonCode = z.infer<typeof ReasonCode>;
export const Resolution = z.enum(['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT', 'REJECT']);
export type Resolution = z.infer<typeof Resolution>;
export const CaseStatus = z.enum(['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'AUTO_APPROVED', 'PENDING_HUMAN', 'APPROVED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED', 'FAILED', 'APPEALED', 'CLOSED']);
export type CaseStatus = z.infer<typeof CaseStatus>;

// ================================================================ buyer [returns]
/** POST /returns — buyer who owns a DELIVERED (or SHIPPED for NOT_DELIVERED/LATE) order */
export const ReturnInputSchema = z.object({
  orderId: z.uuid(),
  lines: z.array(z.object({ productId: z.uuid(), qty: z.int().min(1) })).min(1),
  reasonCode: ReasonCode,
  /** untrusted buyer text — stored and shown as quoted data, never instructions */
  buyerText: z.string().trim().min(10).max(2000),
  preferred: z.enum(['REFUND', 'REPLACEMENT']).default('REFUND'),
});
export type ReturnInput = z.infer<typeof ReturnInputSchema>;
export const ReturnRejectionSchema = z.object({ code: z.enum(['NOT_OWNER', 'ORDER_NOT_ELIGIBLE', 'OUTSIDE_WINDOW', 'ALREADY_OPEN', 'QTY_EXCEEDS_ORDERED']), message: z.string() });

export const EvidenceSchema = z.object({
  evidenceId: z.uuid(),
  kind: z.enum(['PHOTO', 'TRACKING', 'BUYER_TEXT', 'SELLER_RESPONSE', 'ORDER_SNAPSHOT']),
  /** PHOTO: GET /api/returns/v1/evidence/:evidenceId/image (owner, support, finance, admin) */
  hasImage: z.boolean(),
  /** structured findings (vision/model signals, tracking facts) — signals for policy, never decisions */
  findings: z.record(z.string(), z.unknown()).nullable(),
  at: IsoDate,
});
/** Plain-language timeline for the buyer (no internal risk data) */
export const ReturnViewSchema = z.object({
  currency: z.string(),
  returnId: z.uuid(),
  caseId: z.uuid(),
  orderId: z.uuid(),
  orderNo: z.string(),
  reasonCode: ReasonCode,
  status: CaseStatus,
  statusText: z.string(),
  requestedMinor: Minor,
  approvedMinor: Minor.nullable(),
  resolution: Resolution.nullable(),
  lines: z.array(z.object({ productId: z.uuid(), title: z.string(), qty: z.int(), unitPriceMinor: Minor })),
  evidence: z.array(EvidenceSchema),
  /** buyer-facing explanation of the decision (from structured rationale) */
  explanation: z.string().nullable(),
  canAddPhoto: z.boolean(),
  canAppeal: z.boolean(),
  timeline: z.array(z.object({ status: z.string(), at: IsoDate, text: z.string() })),
  openedAt: IsoDate,
});
export type ReturnView = z.infer<typeof ReturnViewSchema>;
/** GET /returns/mine */
export const MyReturnsSchema = z.object({ currency: z.string(), items: z.array(ReturnViewSchema.pick({ returnId: true, caseId: true, orderNo: true, status: true, statusText: true, requestedMinor: true, approvedMinor: true, openedAt: true })) });
/** POST /returns/:returnId/evidence (multipart `file`, jpeg/png/webp ≤ 8 MB) — buyer owner · POST /returns/:returnId/appeal { note } */
export const AppealInputSchema = z.object({ note: z.string().trim().min(10).max(1000) });

// ================================================================ policy [returns]
/** Versioned, deterministic decision table (LLD §2.7). The LLM never overrides a hard rule. */
export const PolicyResultSchema = z.object({
  policyVersion: z.string(),
  hardReject: z.boolean(),
  allowedOutcomes: z.array(Resolution),
  /** inside the auto-approve envelope (amount, risk, history) — autonomy still decides whether to act */
  autoEligible: z.boolean(),
  requiresHuman: z.boolean(),
  requiredRole: z.enum(['support', 'finance']).nullable(),
  /** dual control: support + finance above the threshold */
  dualControl: z.boolean(),
  ruleHits: z.array(z.object({ rule: z.string(), effect: z.string(), detail: z.string() })),
  refundableMinor: Minor,
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;
/** GET /refund-policy — active version (rules as data, for display) */
export const RefundPolicySchema = z.object({ version: z.string(), effectiveFrom: IsoDate, approvedBy: z.string(), rules: z.array(z.object({ id: z.string(), description: z.string(), effect: z.string() })), returnWindowDays: z.record(z.string(), z.int()), autoMaxMinor: Minor, maxRisk: z.number(), dualControlMinor: Minor });

// ================================================================ agent ↔ returns (internal) [returns]
/** GET /internal/refund-cases/:caseId/context — everything the agent may see (data-minimised: city/pincode only) */
export const CaseContextSchema = z.object({
  currency: z.string(),
  caseId: z.uuid(),
  returnId: z.uuid(),
  status: CaseStatus,
  version: z.int(),
  claim: z.object({ reasonCode: ReasonCode, buyerText: z.string(), preferred: z.enum(['REFUND', 'REPLACEMENT']), lines: z.array(z.object({ productId: z.uuid(), title: z.string(), category: z.string(), qty: z.int(), unitPriceMinor: Minor })) }),
  order: z.object({ orderId: z.uuid(), orderNo: z.string(), status: z.string(), placedAt: IsoDate, deliveredAt: IsoDate.nullable(), shippedAt: IsoDate.nullable(), city: z.string().nullable(), pincode: z.string().nullable(), totalMinor: Minor, capturedMinor: Minor, refundedMinor: Minor, sellerId: z.uuid(), sellerName: z.string() }),
  tracking: z.object({ carrier: z.string().nullable(), trackingNo: z.string().nullable(), carrierStatus: z.enum(['NOT_SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'UNKNOWN']) }),
  buyerHistory: z.object({ refunds90d: z.int(), refundRate180d: z.number(), orders180d: z.int(), accountAgeDays: z.int().nullable() }),
  evidence: z.array(EvidenceSchema),
  requestedMinor: Minor,
});
export type CaseContext = z.infer<typeof CaseContextSchema>;
/** POST /internal/refund-cases/:caseId/policy-eval { riskScore } → PolicyResult (pure, deterministic) */
export const PolicyEvalInputSchema = z.object({ riskScore: z.number().min(0).max(1), signals: z.array(z.string()).default([]) });
/** POST /internal/refund-cases/:caseId/proposal — scope refunds:propose. SHADOW (L1) is stored only. */
export const ProposalInputSchema = z.object({
  runId: z.string(),
  mode: z.enum(['SHADOW', 'RECOMMEND', 'LIVE']),
  outcome: Resolution,
  amountMinor: z.int().min(0),
  confidence: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
  policyVersion: z.string(),
  rationale: z.object({ summary: z.string().max(1000), buyerExplanation: z.string().max(600), ruleHits: z.array(z.string()), evidenceIds: z.array(z.uuid()), signals: z.array(z.string()), model: z.string() }),
  version: z.int(),
});
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
/** POST /internal/refund-cases/:caseId/request-evidence { kind:'PHOTO', message } — WRITE_REVERSIBLE (LIVE only) */
export const EvidenceRequestInputSchema = z.object({ kind: z.literal('PHOTO'), message: z.string().max(300), runId: z.string() });
/** POST /internal/refund-cases/:caseId/execute { amountMinor, runId } — MONEY; only when status AUTO_APPROVED|APPROVED */

// ================================================================ staff [returns]
export const CaseDetailSchema = z.object({
  currency: z.string(),
  caseId: z.uuid(),
  returnId: z.uuid().nullable(),
  orderNo: z.string(),
  status: CaseStatus,
  version: z.int(),
  reasonCode: ReasonCode,
  buyerText: z.string().nullable(),
  requestedMinor: Minor,
  approvedMinor: Minor.nullable(),
  refundableMinor: Minor,
  riskScore: z.number().nullable(),
  requiredRole: z.enum(['support', 'finance']).nullable(),
  dualControl: z.boolean(),
  policy: PolicyResultSchema.nullable(),
  /** items being returned (0.7.1; empty for cases without a return request) */
  lines: z.array(z.object({ productId: z.uuid(), title: z.string(), category: z.string().nullable(), qty: z.int(), unitPriceMinor: Minor })).default([]),
  evidence: z.array(EvidenceSchema),
  /** agent proposal — present for staff only when the agent runs at L2+ (or for admin in any mode) */
  agentProposal: ProposalInputSchema.omit({ version: true }).extend({ at: IsoDate }).nullable(),
  decisions: z.array(z.object({ actor: z.string(), outcome: z.string(), amountMinor: Minor.nullable(), note: z.string().nullable(), at: IsoDate })),
  openedAt: IsoDate,
});
export type CaseDetail = z.infer<typeof CaseDetailSchema>;
/** GET /refund-cases/queue?role=support|finance — support, finance, admin */
export const CaseQueueSchema = z.object({ currency: z.string(), items: z.array(CaseDetailSchema.pick({ caseId: true, orderNo: true, status: true, version: true, reasonCode: true, requestedMinor: true, riskScore: true, requiredRole: true, dualControl: true, openedAt: true })) });
/** POST /refund-cases/:caseId/approve { outcome, amountMinor, note, version } (support; finance for the 2nd approval
 *  under dual control; the same person can never give both) · POST /refund-cases/:caseId/reject { note, version } */
export const CaseApproveInputSchema = z.object({ outcome: z.enum(['REFUND', 'PARTIAL_REFUND', 'STORE_CREDIT', 'REPLACEMENT']), amountMinor: z.int().min(0), note: z.string().trim().max(500).default(''), version: z.int() });
export const CaseRejectInputSchema = z.object({ note: z.string().trim().min(5).max(500), version: z.int() });

/** GET /refund-cases/shadow-report?days=30 — admin: L1 shadow agreement (agent proposal vs final human decision) */
export const ShadowReportSchema = z.object({
  days: z.int(),
  decidedCases: z.int(),
  withProposal: z.int(),
  outcomeAgreement: z.number().min(0).max(1),
  amountAgreement: z.number().min(0).max(1),
  byReason: z.array(z.object({ reasonCode: ReasonCode, cases: z.int(), agreement: z.number() })),
  disagreements: z.array(z.object({ caseId: z.uuid(), orderNo: z.string(), agentOutcome: Resolution, humanOutcome: z.string(), agentAmountMinor: Minor, humanAmountMinor: Minor.nullable() })),
});

// ================================================================ governance [agents]
export const AutonomyLevel = z.int().min(0).max(4);
/** GET /agents/registry — admin; PUT /agents/:agentId/autonomy { level, reason } — admin (audited, effective ≤ 10 s) */
export const AgentRegistrySchema = z.object({
  items: z.array(z.object({
    id: z.string(), version: z.string(), description: z.string(),
    autonomy: AutonomyLevel, maxAutonomy: AutonomyLevel,
    model: z.object({ provider: z.enum(['openai', 'offline']), fast: z.string(), smart: z.string() }),
    budgets: z.object({ maxSteps: z.int(), maxTokens: z.int(), dailyRuns: z.int(), runsToday: z.int() }),
    lastChange: z.object({ by: z.string(), reason: z.string(), at: IsoDate }).nullable(),
  })),
});
export const AutonomyInputSchema = z.object({ level: AutonomyLevel, reason: z.string().trim().min(5).max(300) });
/** GET /agents/:agentId/evals/latest — admin: last offline eval run (dataset + red team) */
export const EvalReportSchema = z.object({
  agentId: z.string(),
  runAt: IsoDate,
  modelProvider: z.enum(['openai', 'offline']),
  model: z.string(),
  datasetSize: z.int(),
  outcomeAccuracy: z.number(),
  amountAccuracy: z.number(),
  byReason: z.array(z.object({ reasonCode: z.string(), cases: z.int(), accuracy: z.number() })),
  redTeam: z.object({ cases: z.int(), unauthorizedMoneyCalls: z.int(), injectionFlagged: z.int() }),
  gate: z.object({ passed: z.boolean(), reasons: z.array(z.string()) }),
});
/** GET /agents/runs?agentId=&limit= — admin: recent runs with steps, tool calls, decision, cost */
export const AgentRunsSchema = z.object({
  items: z.array(z.object({ runId: z.string(), agentId: z.string(), subject: z.string(), mode: z.enum(['SHADOW', 'RECOMMEND', 'LIVE']), status: z.enum(['RUNNING', 'INTERRUPTED', 'COMPLETED', 'FAILED', 'BLOCKED']), steps: z.int(), toolCalls: z.int(), deniedCalls: z.int(), outcome: z.string().nullable(), startedAt: IsoDate, durationMs: z.int().nullable(), tokens: z.int() })),
});

// Events (Events catalog): returns.case_proposed.v1, returns.case_decided.v1, returns.refund_executed.v1,
// agent.run_completed.v1 (+ existing returns.return_requested.v1, agent.escalated.v1).
