import { DependencyError, ServiceClient } from '@ac/nest-common';
import {
  CaseContextSchema,
  PolicyResultSchema,
  RiskResultSchema,
  type CaseContext,
  type PolicyResult,
  type ProposalInput,
  type RiskResult,
} from '@ac/contracts';
import { z } from 'zod';

/**
 * Everything the refund agent's tools may do in other services — one port, two adapters:
 *  - HttpDomain: Kong → returns / fraud with the `agents` client token (realm roles service + agent) and the acting
 *    agent in `X-Agent-Act` (ADR 0015). Idempotency-Key = runId:toolCallId on every mutation.
 *  - FakeDomain (evals): in-memory fixtures + the reference policy (src/evals/reference-policy.ts).
 * Tools never receive tokens or URLs from the model; handlers only call this port.
 */
export interface DomainPort {
  getCaseContext(caseId: string): Promise<CaseContext>;
  scoreRisk(input: { caseId: string; orderId: string; buyerId: string | null; totalMinor: number; requestedMinor: number; pincode: string | null; sellerId: string; signals: string[] }): Promise<RiskResult>;
  evaluatePolicy(caseId: string, body: { riskScore: number; signals: string[] }): Promise<PolicyResult>;
  /** status = case status after the proposal; valid/violations = the returns service's own re-check of the proposal */
  submitProposal(caseId: string, body: ProposalInput, idempotencyKey: string): Promise<{ status: string; valid?: boolean; violations?: string[] }>;
  requestEvidence(caseId: string, body: { kind: 'PHOTO'; message: string; runId: string }, idempotencyKey: string): Promise<{ status: string }>;
  executeRefund(caseId: string, body: { amountMinor: number; runId: string }, idempotencyKey: string): Promise<{ status: string; refundId?: string | null }>;
}

const StatusOut = z.object({ status: z.string() }).loose();
const ProposalOut = z.object({ caseStatus: z.string(), valid: z.boolean().optional(), violations: z.array(z.string()).optional(), duplicate: z.boolean().optional() }).loose();

export class HttpDomain implements DomainPort {
  constructor(private readonly http: ServiceClient, private readonly agentId: string) {}

  private headers() {
    return { 'x-agent-act': `agent:${this.agentId}` };
  }

  getCaseContext(caseId: string) {
    return this.http.call('returns', 'GET', `/internal/refund-cases/${caseId}/context`, { schema: CaseContextSchema, headers: this.headers(), timeoutMs: 3000 });
  }

  /**
   * Order-shaped RiskInput with purpose=refund (contracts 0.7.1): fraud returns the order's checkout score, or for an
   * order never scored evaluates it without storing it, so agent lookups never count toward checkout velocity.
   * Refund-specific signals (refund velocity, linked accounts) are future work in the fraud service.
   */
  async scoreRisk(i: Parameters<DomainPort['scoreRisk']>[0]) {
    // without the buyer id (manual re-run of an old case) a fraud call would create a misleading order score → neutral
    if (!i.buyerId) return { orderId: i.orderId, decision: 'REVIEW' as const, score: 0.5, rules: ['risk_unavailable'] };
    try {
      return await this.http.call('fraud', 'POST', '/internal/risk/score', {
        body: { orderId: i.orderId, buyerId: i.buyerId, totalMinor: i.requestedMinor, itemCount: 1, sellerIds: [i.sellerId], pincode: i.pincode ?? '' /* unknown must not look like a blocked pincode */, accountCreatedAt: null, purpose: 'refund' },
        schema: RiskResultSchema,
        headers: this.headers(),
        timeoutMs: 1500,
      });
    } catch (e) {
      // fraud down → neutral-high risk: the case can still be proposed but never auto-executes (policy needs risk < max)
      if (e instanceof DependencyError) return { orderId: i.orderId, decision: 'REVIEW' as const, score: 0.5, rules: ['risk_unavailable'] };
      throw e;
    }
  }

  evaluatePolicy(caseId: string, body: { riskScore: number; signals: string[] }) {
    return this.http.call('returns', 'POST', `/internal/refund-cases/${caseId}/policy-eval`, { body, schema: PolicyResultSchema, headers: this.headers(), timeoutMs: 3000 });
  }

  async submitProposal(caseId: string, body: ProposalInput, idempotencyKey: string) {
    const r = await this.http.call('returns', 'POST', `/internal/refund-cases/${caseId}/proposal`, { body, schema: ProposalOut, headers: this.headers(), idempotencyKey, timeoutMs: 3000 });
    return { status: r.caseStatus, valid: r.valid, violations: r.violations };
  }

  requestEvidence(caseId: string, body: { kind: 'PHOTO'; message: string; runId: string }, idempotencyKey: string) {
    return this.http.call('returns', 'POST', `/internal/refund-cases/${caseId}/request-evidence`, { body, schema: StatusOut, headers: this.headers(), idempotencyKey, timeoutMs: 3000 });
  }

  executeRefund(caseId: string, body: { amountMinor: number; runId: string }, idempotencyKey: string) {
    return this.http.call('returns', 'POST', `/internal/refund-cases/${caseId}/execute`, { body, schema: StatusOut, headers: this.headers(), idempotencyKey, timeoutMs: 8000 }) as Promise<{ status: string; refundId?: string | null }>;
  }
}

/** The agents service's own HTTP client: client credentials of the `agents` client (KEYCLOAK_AGENTS_CLIENT_SECRET). */
export const agentServiceClient = () => new ServiceClient(fetch, { clientId: process.env.AGENT_CLIENT_ID ?? 'agents', clientSecretEnv: 'KEYCLOAK_AGENTS_CLIENT_SECRET' });
