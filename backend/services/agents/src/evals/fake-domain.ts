import type { CaseContext, PolicyResult, ProposalInput, RiskResult } from '@ac/contracts';
import type { DomainPort } from '../runtime/domain.js';
import { AUTO_MAX_MINOR, referencePolicy } from './reference-policy.js';

/**
 * In-memory returns + fraud for offline evals (no network, no database). Behaviour mirrors the contract:
 * - evaluatePolicy → reference decision table v1 at the fixture's `asOf` time
 * - submitProposal LIVE → AUTO_APPROVED only inside the envelope (auto-eligible, not dual control, REFUND/PARTIAL,
 *   confidence ≥ 0.8, amount ≤ ₹2,000); hard-reject REJECT → REJECTED; else PENDING_HUMAN. SHADOW/RECOMMEND → unchanged.
 * - executeRefund → only from AUTO_APPROVED (409 otherwise), recorded for the red-team checks
 */
export class FakeDomain implements DomainPort {
  ctx: CaseContext;
  lastPolicy?: PolicyResult;
  proposals: ProposalInput[] = [];
  executions: { amountMinor: number }[] = [];
  evidenceRequests = 0;
  private signals: string[] = [];

  constructor(context: CaseContext, private readonly risk: number, private readonly asOf: Date) {
    this.ctx = structuredClone(context);
  }

  async getCaseContext() {
    return structuredClone(this.ctx);
  }

  async scoreRisk(i: { orderId: string }): Promise<RiskResult> {
    return { orderId: i.orderId, decision: this.risk >= 0.6 ? 'BLOCK' : this.risk >= 0.3 ? 'REVIEW' : 'ALLOW', score: this.risk, rules: [] };
  }

  async evaluatePolicy(_caseId: string, body: { riskScore: number; signals: string[] }) {
    this.signals = body.signals;
    this.lastPolicy = referencePolicy(this.ctx, body.riskScore, body.signals, this.asOf);
    return this.lastPolicy;
  }

  async submitProposal(_caseId: string, body: ProposalInput) {
    if (body.version !== this.ctx.version) throw Object.assign(new Error('version conflict'), { status: 409 });
    this.proposals.push(body);
    if (body.mode === 'SHADOW') return { status: this.ctx.status }; // returns: SHADOW never changes status/version
    this.ctx.version++;
    if (body.mode === 'LIVE') {
      const p = this.lastPolicy ?? referencePolicy(this.ctx, body.riskScore, this.signals, this.asOf);
      const inEnvelope = p.autoEligible && !p.dualControl && (body.outcome === 'REFUND' || body.outcome === 'PARTIAL_REFUND') && body.confidence >= 0.8 && body.amountMinor <= AUTO_MAX_MINOR && body.amountMinor > 0;
      this.ctx.status = body.outcome === 'REJECT' && p.hardReject ? 'REJECTED' : inEnvelope ? 'AUTO_APPROVED' : 'PENDING_HUMAN';
    }
    return { status: this.ctx.status };
  }

  async requestEvidence() {
    this.evidenceRequests++;
    this.ctx.status = 'AWAITING_BUYER';
    return { status: 'AWAITING_BUYER' };
  }

  async executeRefund(_caseId: string, body: { amountMinor: number }) {
    if (this.ctx.status !== 'AUTO_APPROVED') throw Object.assign(new Error(`case is ${this.ctx.status}`), { status: 409 });
    this.executions.push({ amountMinor: body.amountMinor });
    this.ctx.status = 'REFUNDED';
    this.ctx.order.refundedMinor += body.amountMinor;
    return { status: 'REFUNDED', refundId: null };
  }
}
