import { MemorySaver } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeDomain } from '../../../evals/fake-domain.js';
import { generateDataset, type EvalCase } from '../../../evals/generate.js';
import { RunTokens } from '../../../gateway/budget.service.js';
import { ToolInvoker } from '../../../tools/invoke-tool.js';
import { eventCounter, modeFor } from '../../agent-runner.service.js';
import { registerRun, releaseRun, type RunContext } from '../../context.js';
import { offlineRefundModel } from '../../models/offline.js';
import type { AutonomyLevel } from '../../types.js';
import { buildRefundGraph, validateProposal, type RefundStateT } from './graph.js';

/** Minimal stand-in for tools.rego (the real policy is covered by `opa test` and the eval runner). */
const stubOpa = {
  async decide(i: any) {
    const lvl = i.agent.autonomy_level;
    if (i.tool_tier === 'READ') return { allow: true, reasons: [] };
    if (i.tool === 'submitProposal') return { allow: i.args.mode === 'LIVE' ? lvl >= 3 : lvl >= 1, reasons: [] };
    if (i.tool_tier === 'WRITE_REVERSIBLE') return { allow: lvl >= 3, reasons: [] };
    if (i.tool_tier === 'MONEY') return { allow: lvl >= 3 && i.case.status === 'AUTO_APPROVED' && i.case.auto_eligible && i.args.amount_minor <= 200_000, reasons: ['stub envelope'] };
    return { allow: false, reasons: [] };
  },
};
const audit = { rows: [] as any[], async record(r: any) { this.rows.push(r); } };
const invoker = new ToolInvoker(stubOpa as never, audit as never);
const graph = buildRefundGraph(new MemorySaver());
const ds = generateDataset();
const find = (pred: (c: EvalCase) => boolean) => {
  const c = ds.find(pred);
  if (!c) throw new Error('fixture not found');
  return c;
};

async function run(c: EvalCase, level: AutonomyLevel, opts: { current?: () => Promise<AutonomyLevel>; maxTokens?: number } = {}) {
  const fake = new FakeDomain(c.context, c.risk, new Date(c.asOf));
  const runId = randomUUID();
  const counter = eventCounter();
  const ctx: RunContext = {
    runId, agentId: 'refund', threadId: c.id, autonomyLevel: level, emit: counter.emit, invokeTool: (cc, n, a, o) => invoker.invoke(cc, n, a, o),
    currentAutonomy: opts.current ?? (async () => level), domain: fake, model: offlineRefundModel, tokens: new RunTokens(opts.maxTokens ?? 20_000), facts: { buyerId: null },
  };
  registerRun(ctx);
  try {
    const state = (await graph.invoke({ caseId: c.context.caseId, mode: modeFor(level) }, { configurable: { thread_id: runId, run_id: runId }, recursionLimit: 12 })) as RefundStateT;
    return { state, fake, counter };
  } finally {
    releaseRun(runId);
  }
}

describe('refund graph', () => {
  const eligible = find((c) => c.expected.liveAction === 'EXECUTE' && !c.tags.includes('mismatch'));

  it('L1 shadow: stores a SHADOW proposal and never moves money', async () => {
    const { state, fake } = await run(eligible, 1);
    expect(fake.proposals).toHaveLength(1);
    expect(fake.proposals[0].mode).toBe('SHADOW');
    expect(fake.executions).toHaveLength(0);
    expect(state.result?.status).toBe('COMPLETED');
    expect(fake.ctx.status).toBe('REQUESTED');
  });

  it('L2 recommend: RECOMMEND proposal, no money', async () => {
    const { fake } = await run(eligible, 2);
    expect(fake.proposals[0].mode).toBe('RECOMMEND');
    expect(fake.executions).toHaveLength(0);
  });

  it('L3 live: auto-approves and executes a small low-risk refund', async () => {
    const { state, fake } = await run(eligible, 3);
    expect(fake.executions).toHaveLength(1);
    expect(fake.executions[0].amountMinor).toBeLessThanOrEqual(200_000);
    expect(state.result).toMatchObject({ status: 'COMPLETED', executed: true });
  });

  it('kill switch flipped mid-run (L3 → L0 before the money call) → denied, audited, escalated', async () => {
    let calls = 0;
    // first mutating call (submitProposal) sees L3, the money call sees L0
    const { state, fake } = await run(eligible, 3, { current: async () => (calls++ === 0 ? 3 : 0) });
    expect(fake.executions).toHaveLength(0);
    expect(state.result).toMatchObject({ status: 'INTERRUPTED', escalate: true });
    expect(audit.rows.some((r) => r.tool === 'executeRefund' && !r.allowed && r.reasons.join().includes('L0'))).toBe(true);
  });

  it('L3 live: damaged without photo → asks the buyer for evidence instead of deciding', async () => {
    const c = find((x) => x.expected.liveAction === 'REQUEST_EVIDENCE' && !x.tags.includes('mismatch') && !x.tags.includes('hard-text'));
    const { state, fake } = await run(c, 3);
    expect(fake.evidenceRequests).toBe(1);
    expect(state.result?.outcome).toBe('AWAITING_BUYER');
    expect(fake.proposals).toHaveLength(0);
  });

  it('L3 live: outside the envelope (dual control) → escalates to a human', async () => {
    const c = find((x) => x.tags.includes('dual-control') && x.expected.liveAction === 'ESCALATE' && !x.tags.includes('mismatch'));
    const { state, fake } = await run(c, 3);
    expect(fake.executions).toHaveLength(0);
    expect(state.result).toMatchObject({ status: 'INTERRUPTED', escalate: true });
  });

  it('hard reject at L3 completes with REJECT (buyer may appeal), no escalation', async () => {
    const c = find((x) => x.expected.liveAction === 'REJECT' && !x.tags.includes('mismatch') && !x.tags.includes('hard-text'));
    const { state } = await run(c, 3);
    expect(state.result).toMatchObject({ status: 'COMPLETED', outcome: 'REJECT', escalate: false });
  });
});

describe('validateProposal', () => {
  const p = { policyVersion: 'v1', hardReject: false, allowedOutcomes: ['REFUND', 'STORE_CREDIT'], autoEligible: true, requiresHuman: false, requiredRole: null, dualControl: false, ruleHits: [], refundableMinor: 50_000 } as any;
  const d = (o: any) => ({ outcome: 'REFUND', amountMinor: 10_000, confidence: 0.9, summary: '', buyerExplanation: '', ...o });
  it('accepts an allowed, capped proposal', () => expect(validateProposal(d({}), p, 20_000, 50_000)).toEqual([]));
  it('rejects disallowed outcomes and over-cap amounts', () => {
    expect(validateProposal(d({ outcome: 'REPLACEMENT', amountMinor: 0 }), p, 20_000, 50_000).length).toBeGreaterThan(0);
    expect(validateProposal(d({ amountMinor: 30_000 }), p, 20_000, 50_000)).toContain('amount exceeds the requested amount');
    expect(validateProposal(d({ amountMinor: 10_000 }), p, 20_000, 5_000)).toContain('amount exceeds the refundable amount');
    expect(validateProposal(d({ outcome: 'REJECT', amountMinor: 0 }), p, 20_000, 50_000)).toContain('REJECT proposed but the policy has no hard reject');
  });
});

describe('token budget', () => {
  it('aborts when a run exceeds maxTokens', () => {
    const t = new RunTokens(100);
    t.add(60);
    expect(() => t.add(60)).toThrow(/budget exceeded/);
  });
});
