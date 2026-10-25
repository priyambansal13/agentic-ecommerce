import type { CaseContext, PolicyResult, Resolution } from '@ac/contracts';
import { DependencyError } from '@ac/nest-common';
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, type BaseCheckpointSaver, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolDeniedError } from '../../../tools/invoke-tool.js';
import { runContext, toolkit } from '../../context.js';
import type { Classification, ProposalDraft, UsageMeter } from '../../models.js';
import { redactPII, toneCheck } from '../../prompting.js';
import type { AgentDefinition, AgentGraph } from '../../types.js';
import { config } from './agent.config.js';

/**
 * Refund graph (docs/03 A1, as built):
 *
 *   load → intake → check_evidence ─(LIVE & photo missing)→ request_evidence → END (AWAITING_BUYER)
 *                             └→ score_risk → evaluate_policy → propose → validate ─(invalid)→ escalate
 *                                                       └→ submit ─ SHADOW/RECOMMEND → END
 *                                                               └ LIVE → (AUTO_APPROVED & conf ≥ 0.8 & in envelope) → execute → END
 *                                                                      └ otherwise → escalate (human queue) → END
 *
 * Mode comes from the autonomy level at run start: L1 SHADOW (stored only), L2 RECOMMEND (support sees it),
 * L3 LIVE. The invoker re-checks the CURRENT level before every WRITE/MONEY call, so a kill switch mid-run denies.
 * Guardrails: buyer text is PII-redacted and passed to the model as untrusted data; injection → signal + risk;
 * outcome must be allowed by the deterministic policy; amount ≤ requested and refundable; tone check.
 */
export type Mode = 'SHADOW' | 'RECOMMEND' | 'LIVE';
export type RunStatus = 'COMPLETED' | 'INTERRUPTED' | 'FAILED' | 'BLOCKED';
export interface RunResult {
  status: RunStatus;
  outcome: string | null;
  reason: string;
  escalate: boolean;
  executed: boolean;
}

const ACTIONABLE = new Set(['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'APPEALED', 'PROPOSED', 'PENDING_HUMAN']);
const MONEY_OUTCOMES = new Set<Resolution>(['REFUND', 'PARTIAL_REFUND']);
export const AUTO_CONFIDENCE = 0.8;

const replace = <T>() => Annotation<T>({ reducer: (_a: T, b: T) => b, default: () => null as T });
export const RefundState = Annotation.Root({
  ...MessagesAnnotation.spec,
  caseId: replace<string>(),
  mode: replace<Mode>(),
  context: replace<CaseContext | null>(),
  classification: replace<Classification | null>(),
  signals: Annotation<string[]>({ reducer: (a, b) => [...new Set([...a, ...b])], default: () => [] }),
  needsPhoto: replace<boolean>(),
  risk: replace<number | null>(),
  policy: replace<PolicyResult | null>(),
  draft: replace<ProposalDraft | null>(),
  result: replace<RunResult | null>(),
});
export type RefundStateT = typeof RefundState.State;

const meter = (cfg: RunnableConfig): UsageMeter => {
  const ctx = runContext(cfg);
  return (u) => {
    ctx.tokens?.add(u.input + u.output);
    ctx.trace?.generation(u.task, u.model, u.startedAt, u.prompt, u.result, { input: u.input, output: u.output });
  };
};
const model = (cfg: RunnableConfig) => {
  const m = runContext(cfg).model;
  if (!m) throw new Error('no model in run context');
  return m;
};
const done = (r: Partial<RunResult> & { status: RunStatus; reason: string }): { result: RunResult } => ({ result: { outcome: null, escalate: false, executed: false, ...r } });
const escalate = (reason: string, outcome: string | null = null) => done({ status: 'INTERRUPTED', reason, outcome, escalate: true });

async function load(s: RefundStateT, cfg: RunnableConfig) {
  const context = await toolkit(cfg).call<CaseContext>('getCaseContext', { caseId: s.caseId });
  if (!ACTIONABLE.has(context.status)) return { context, ...done({ status: 'COMPLETED', reason: `case already ${context.status} — nothing to do` }) };
  return { context };
}

async function intake(s: RefundStateT, cfg: RunnableConfig) {
  const c = s.context!;
  try {
    const classification = await model(cfg).classify(
      { statedReason: c.claim.reasonCode, buyerText: redactPII(c.claim.buyerText), preferred: c.claim.preferred, lines: c.claim.lines.map((l) => ({ title: l.title, category: l.category, qty: l.qty })) },
      meter(cfg),
    );
    const signals = [
      ...(classification.injection ? ['injection_attempt'] : []),
      ...(classification.mismatch ? ['reason_mismatch', `reclassified:${classification.reasonCode}`] : []),
    ];
    return { classification, signals };
  } catch (e) {
    return escalate(`model_error: ${(e as Error).message}`);
  }
}

async function evidence(s: RefundStateT) {
  const reason = s.classification!.reasonCode;
  const hasPhoto = s.context!.evidence.some((e) => e.kind === 'PHOTO');
  const needsPhoto = (reason === 'DAMAGED' || reason === 'WRONG_ITEM') && !hasPhoto;
  return { needsPhoto, signals: needsPhoto ? ['needs_photo'] : [] };
}

async function requestEvidence(s: RefundStateT, cfg: RunnableConfig) {
  try {
    await toolkit(cfg).call('requestBuyerEvidence', { caseId: s.caseId, message: 'Please add a clear photo of the item and the problem so we can resolve your request quickly.' });
    return done({ status: 'INTERRUPTED', reason: 'awaiting buyer photo', outcome: 'AWAITING_BUYER' });
  } catch (e) {
    if (e instanceof ToolDeniedError) return escalate(`evidence request denied: ${e.reasons.join('; ')}`);
    throw e;
  }
}

async function risk(s: RefundStateT, cfg: RunnableConfig) {
  const c = s.context!;
  const r = await toolkit(cfg).call<{ score: number; rules: string[] }>('scoreRisk', {
    caseId: s.caseId, orderId: c.order.orderId, requestedMinor: c.requestedMinor, totalMinor: c.order.totalMinor, pincode: c.order.pincode, sellerId: c.order.sellerId, signals: s.signals,
  });
  // an injection attempt is a risk signal (never authority): +0.2
  const score = Math.min(1, Math.round((r.score + (s.signals.includes('injection_attempt') ? 0.2 : 0)) * 100) / 100);
  return { risk: score, signals: r.rules.map((x) => `risk:${x}`) };
}

async function policy(s: RefundStateT, cfg: RunnableConfig) {
  const p = await toolkit(cfg).call<PolicyResult>('evaluatePolicy', { caseId: s.caseId, riskScore: s.risk ?? 0.5, signals: s.signals.filter((x) => !x.startsWith('risk:')) });
  return { policy: p };
}

async function propose(s: RefundStateT, cfg: RunnableConfig) {
  const c = s.context!;
  try {
    const draft = await model(cfg).propose(
      {
        currency: c.currency, reasonCode: s.classification!.reasonCode, preferred: c.claim.preferred, requestedMinor: c.requestedMinor,
        refundableMinor: Math.max(0, c.order.capturedMinor - c.order.refundedMinor), policy: s.policy!, riskScore: s.risk ?? 0.5,
        signals: s.signals, hasPhoto: c.evidence.some((e) => e.kind === 'PHOTO'), classification: s.classification!,
      },
      meter(cfg),
    );
    const tone = toneCheck(draft.buyerExplanation, false);
    return { draft: { ...draft, buyerExplanation: tone.text }, signals: tone.intervened ? ['tone_fixed'] : [] };
  } catch (e) {
    return escalate(`model_error: ${(e as Error).message}`);
  }
}

/** Deterministic checks on the model's proposal — anything off goes to a human. */
export function validateProposal(d: ProposalDraft, p: PolicyResult, requestedMinor: number, refundableMinor: number): string[] {
  const errors: string[] = [];
  if (d.outcome === 'REJECT' && !p.hardReject) errors.push('REJECT proposed but the policy has no hard reject');
  if (d.outcome !== 'REJECT' && !p.allowedOutcomes.includes(d.outcome)) errors.push(`outcome ${d.outcome} not allowed by policy ${p.policyVersion}`);
  if (p.hardReject && d.outcome !== 'REJECT') errors.push('policy hard-rejects but a resolution was proposed');
  if (d.amountMinor < 0 || !Number.isInteger(d.amountMinor)) errors.push('amount must be a non-negative integer (paise)');
  if (d.amountMinor > requestedMinor) errors.push('amount exceeds the requested amount');
  if (d.amountMinor > refundableMinor) errors.push('amount exceeds the refundable amount');
  if (d.outcome === 'REPLACEMENT' && d.amountMinor !== 0) errors.push('replacement must not carry an amount');
  if ((d.outcome === 'REFUND' || d.outcome === 'PARTIAL_REFUND' || d.outcome === 'STORE_CREDIT') && d.amountMinor === 0) errors.push('refund outcome with zero amount');
  if (d.confidence < 0 || d.confidence > 1) errors.push('confidence out of range');
  return errors;
}

async function validate(s: RefundStateT) {
  const c = s.context!;
  const errors = validateProposal(s.draft!, s.policy!, c.requestedMinor, Math.max(0, c.order.capturedMinor - c.order.refundedMinor));
  return errors.length ? { signals: ['validation_failed'], ...escalate(`proposal invalid: ${errors.join('; ')}`, s.draft!.outcome) } : {};
}

async function submit(s: RefundStateT, cfg: RunnableConfig) {
  const c = s.context!;
  const ctx = runContext(cfg);
  const d = s.draft!;
  let stored: { status: string; valid?: boolean; violations?: string[] };
  try {
    stored = await toolkit(cfg).call('submitProposal', {
      caseId: s.caseId, runId: ctx.runId, mode: s.mode, outcome: d.outcome, amountMinor: d.amountMinor, confidence: d.confidence,
      riskScore: s.risk ?? 0.5, policyVersion: s.policy!.policyVersion,
      rationale: {
        summary: d.summary.slice(0, 1000), buyerExplanation: d.buyerExplanation.slice(0, 600),
        ruleHits: s.policy!.ruleHits.map((h) => `${h.rule}:${h.effect}`), evidenceIds: c.evidence.map((e) => e.evidenceId),
        signals: s.signals, model: ctx.model?.name ?? 'unknown',
      },
      version: c.version,
    });
  } catch (e) {
    if (e instanceof ToolDeniedError) return escalate(`proposal denied: ${e.reasons.join('; ')}`, d.outcome);
    // returns answers 409 (stale version) / 422 (outside policy, re-evaluated server-side) → a human looks at it
    if (e instanceof DependencyError && e.status >= 400 && e.status < 500) return escalate(`proposal refused by returns (${e.status}): ${JSON.stringify(e.body).slice(0, 200)}`, d.outcome);
    throw e;
  }
  const serverCheck = stored.valid === false ? ` — returns flagged: ${(stored.violations ?? []).join('; ')}` : '';
  if (s.mode !== 'LIVE') return { ...done({ status: 'COMPLETED', reason: `${s.mode.toLowerCase()} proposal stored${serverCheck}`, outcome: d.outcome }), signals: stored.valid === false ? ['returns_violation'] : [], messages: [] };
  // policy hard reject: explain + the buyer may appeal (returns records the rejection) — no human hand-off needed
  if (d.outcome === 'REJECT' && s.policy!.hardReject) return { ...done({ status: 'COMPLETED', reason: 'rejected by policy (buyer may appeal)', outcome: 'REJECT' }), messages: [new AIMessage(d.buyerExplanation)] };
  // LIVE: only an AUTO_APPROVED case inside the envelope with enough confidence is executed by the agent
  const fresh = await toolkit(cfg).call<CaseContext>('getCaseContext', { caseId: s.caseId });
  const auto = fresh.status === 'AUTO_APPROVED' && s.policy!.autoEligible && !s.policy!.dualControl && MONEY_OUTCOMES.has(d.outcome) && d.confidence >= AUTO_CONFIDENCE;
  if (!auto) return escalate(`needs human review (case ${fresh.status}, confidence ${d.confidence}, policy ${s.policy!.autoEligible ? 'auto-eligible' : 'outside envelope'})`, d.outcome);
  return { context: fresh };
}

async function execute(s: RefundStateT, cfg: RunnableConfig) {
  const ctx = runContext(cfg);
  ctx.facts = { ...ctx.facts, signals: s.signals.filter((x) => !x.startsWith('risk:')).join(',') };
  try {
    const r = await toolkit(cfg).call<{ status: string }>('executeRefund', { caseId: s.caseId, amountMinor: s.draft!.amountMinor, outcome: s.draft!.outcome });
    const tone = toneCheck(`Your refund of ₹${(s.draft!.amountMinor / 100).toLocaleString('en-IN')} has been processed.`, true);
    return { ...done({ status: 'COMPLETED', reason: `refund executed (${r.status})`, outcome: 'EXECUTED', executed: true }), messages: [new AIMessage(tone.text)] };
  } catch (e) {
    if (e instanceof ToolDeniedError) return escalate(`refund execution denied: ${e.reasons.join('; ')}`, s.draft!.outcome);
    return escalate(`refund execution failed: ${(e as Error).message}`, s.draft!.outcome);
  }
}

const stopOr = (next: string) => (s: RefundStateT) => (s.result ? END : next);

export function buildRefundGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(RefundState)
    .addNode('load', load)
    .addNode('intake', intake)
    .addNode('check_evidence', evidence)
    .addNode('request_evidence', requestEvidence)
    .addNode('score_risk', risk)
    .addNode('evaluate_policy', policy)
    .addNode('propose', propose)
    .addNode('validate', validate)
    .addNode('submit', submit)
    .addNode('execute', execute)
    .addEdge(START, 'load')
    .addConditionalEdges('load', stopOr('intake'), ['intake', END])
    .addConditionalEdges('intake', stopOr('check_evidence'), ['check_evidence', END])
    .addConditionalEdges('check_evidence', (s: RefundStateT) => (s.needsPhoto && s.mode === 'LIVE' ? 'request_evidence' : 'score_risk'), ['request_evidence', 'score_risk'])
    .addEdge('request_evidence', END)
    .addEdge('score_risk', 'evaluate_policy')
    .addEdge('evaluate_policy', 'propose')
    .addConditionalEdges('propose', stopOr('validate'), ['validate', END])
    .addConditionalEdges('validate', stopOr('submit'), ['submit', END])
    .addConditionalEdges('submit', stopOr('execute'), ['execute', END])
    .addEdge('execute', END)
    .compile(checkpointer ? { checkpointer } : {});
}

export const refundAgent: AgentDefinition = {
  config,
  build: (checkpointer) => buildRefundGraph(checkpointer) as unknown as AgentGraph,
  // buyer-safe projection (no risk score, no rule internals)
  uiState: (v: RefundStateT) => ({ caseId: v.caseId, status: v.result?.status ?? 'RUNNING', outcome: v.result?.executed ? 'REFUNDED' : null }),
};
