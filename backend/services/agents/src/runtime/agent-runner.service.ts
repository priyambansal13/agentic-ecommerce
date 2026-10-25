import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TOPICS } from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import type { BaseEvent } from '@ag-ui/core';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BudgetExceeded, BudgetService, RunTokens } from '../gateway/budget.service.js';
import { AutonomyService } from '../governance/autonomy.service.js';
import { RunTrace } from '../governance/tracing.js';
import { ToolInvoker } from '../tools/invoke-tool.js';
import { AgentRuntime } from './agent-runtime.service.js';
import { registerRun, releaseRun, type RunContext } from './context.js';
import { agentServiceClient, HttpDomain, type DomainPort } from './domain.js';
import type { Mode, RefundStateT, RunResult } from './graphs/refund/graph.js';
import { refundModel, type RefundModel } from './models.js';
import type { AutonomyLevel } from './types.js';

export const modeFor = (level: AutonomyLevel): Mode => (level >= 3 ? 'LIVE' : level === 2 ? 'RECOMMEND' : 'SHADOW');

export interface SubjectRun {
  agentId: string;
  caseId: string;
  trigger: string;
  facts: Record<string, string | null>;
}

export interface RunSummary {
  runId: string;
  mode: Mode | null;
  autonomy: AutonomyLevel;
  status: RunResult['status'];
  outcome: string | null;
  reason: string;
  steps: number;
  toolCalls: number;
  deniedCalls: number;
  tokens: number;
  executed: boolean;
  escalated: boolean;
  state?: RefundStateT;
}

/** Counts tool calls / denials from the AG-UI event stream the invoker emits. */
export function eventCounter() {
  const c = { toolCalls: 0, denied: 0, money: [] as { tool: string; allowed: boolean }[] };
  const pending = new Map<string, string>();
  const emit = (e: BaseEvent) => {
    const ev = e as unknown as Record<string, any>;
    if (ev.type === 'TOOL_CALL_START') {
      c.toolCalls++;
      pending.set(ev.toolCallId, ev.toolCallName);
    }
    if (ev.type === 'TOOL_CALL_RESULT') {
      const denied = typeof ev.content === 'string' && ev.content.includes('"denied":true');
      if (denied) c.denied++;
      const tool = pending.get(ev.toolCallId);
      if (tool === 'executeRefund') c.money.push({ tool, allowed: !denied && !ev.content.includes('"error"') });
    }
  };
  return { counts: c, emit };
}

/**
 * Runs an agent graph for a SUBJECT (e.g. a refund case) outside any HTTP request — triggered by events or admins.
 * budgets → autonomy (L0 → BLOCKED) → graph (Postgres checkpoints, fresh thread per run) → agent_runs row →
 * outbox agent.run_completed.v1 (+ agent.escalated.v1 when a LIVE run hands over to a human).
 */
@Injectable()
export class AgentRunner {
  private readonly log = new Logger(AgentRunner.name);
  private readonly http = agentServiceClient();

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly tools: ToolInvoker,
    private readonly autonomy: AutonomyService,
    private readonly budget: BudgetService,
    private readonly db: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async runSubject(req: SubjectRun, deps: { domain?: DomainPort; model?: RefundModel } = {}): Promise<RunSummary> {
    const entry = this.runtime.compiled(req.agentId);
    if (!entry) throw new NotFoundException(`unknown agent ${req.agentId}`);
    const { def, graph } = entry;
    const runId = randomUUID();
    const subject = `case:${req.caseId}`;
    const level = await this.autonomy.level(def.config.id, def.config.autonomyDefault);
    const mode = modeFor(level);
    const model = deps.model ?? refundModel();
    await this.db.query(`INSERT INTO agent_runs (run_id, agent_id, subject, mode, status, autonomy, model) VALUES ($1,$2,$3,$4,'RUNNING',$5,$6)`, [runId, req.agentId, subject, mode, level, model.name]);

    const finish = async (s: RunSummary, policyRole?: string | null) => {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE agent_runs SET status=$2, steps=$3, tool_calls=$4, denied_calls=$5, tokens=$6, outcome=$7, error=$8, finished_at=now() WHERE run_id=$1`,
          [runId, s.status, s.steps, s.toolCalls, s.deniedCalls, s.tokens, s.outcome, s.status === 'COMPLETED' ? null : s.reason.slice(0, 500)],
        );
        await this.outbox.enqueue(tx, {
          topic: TOPICS.agent, type: 'agent.run_completed.v1', aggregateId: subject,
          data: { runId, agentId: req.agentId, subject, mode: s.mode ?? 'SHADOW', status: s.status, outcome: s.outcome, steps: s.steps, toolCalls: s.toolCalls, deniedCalls: s.deniedCalls },
        });
        if (s.escalated)
          await this.outbox.enqueue(tx, {
            topic: TOPICS.agent, type: 'agent.escalated.v1', aggregateId: subject,
            data: { runId, agentId: req.agentId, approvalId: randomUUID(), requiredRole: policyRole === 'finance' ? 'finance' : 'support', subject },
          });
      });
      return s;
    };
    const base = { runId, mode, autonomy: level, steps: 0, toolCalls: 0, deniedCalls: 0, tokens: 0, executed: false, outcome: null } as const;

    if (level === 0) return finish({ ...base, status: 'BLOCKED', reason: 'agent disabled (L0 kill switch)', escalated: false });
    try {
      await this.budget.takeRun(def.config.id, req.facts.buyerId ?? subject, def.config.budgets);
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      this.log.warn(`run ${runId} blocked: ${e.message}`);
      return finish({ ...base, status: 'BLOCKED', reason: e.message, escalated: mode === 'LIVE' });
    }

    const counter = eventCounter();
    const tokens = new RunTokens(def.config.budgets.maxTokens);
    const trace = new RunTrace(`agent:${req.agentId}`, { runId, subject, mode, autonomy: level, model: model.name });
    const ctx: RunContext = {
      runId, agentId: req.agentId, threadId: subject, autonomyLevel: level, emit: counter.emit,
      invokeTool: (c, name, args, opts) => this.tools.invoke(c, name, args, opts),
      currentAutonomy: () => this.autonomy.level(def.config.id, def.config.autonomyDefault),
      domain: deps.domain ?? new HttpDomain(this.http, req.agentId),
      model, tokens, trace, facts: { ...req.facts },
    };
    registerRun(ctx);
    let steps = 0;
    let state: RefundStateT | undefined;
    try {
      const config = {
        configurable: { thread_id: `${req.agentId}:${subject}:${runId}`, run_id: runId },
        recursionLimit: def.config.budgets.maxSteps,
        signal: AbortSignal.timeout(def.config.budgets.wallClockMs),
        runName: `agent:${req.agentId}`,
        metadata: { agentId: req.agentId, agentVersion: def.config.version, runId, subject, mode },
        streamMode: 'updates' as const,
      };
      for await (const chunk of await graph.stream({ caseId: req.caseId, mode }, config)) {
        for (const node of Object.keys(chunk)) {
          if (node.startsWith('__')) continue;
          steps++;
          trace.span(node, new Date(), null, null);
        }
      }
      state = (await graph.getState(config)).values as RefundStateT;
      const r = state.result ?? { status: 'FAILED', outcome: null, reason: 'graph ended without a result', escalate: false, executed: false };
      const summary: RunSummary = {
        runId, mode, autonomy: level, status: r.status, outcome: r.outcome, reason: r.reason, steps,
        toolCalls: counter.counts.toolCalls, deniedCalls: counter.counts.denied, tokens: tokens.used,
        executed: r.executed, escalated: r.escalate && mode === 'LIVE', state,
      };
      await trace.flush({ status: r.status, outcome: r.outcome, reason: r.reason });
      return await finish(summary, state.policy?.requiredRole ?? null);
    } catch (e) {
      const reason = e instanceof BudgetExceeded ? e.message : `error: ${(e as Error).message}`;
      this.log.error(`run ${runId} (${subject}) failed: ${reason}`);
      await trace.flush({ status: 'FAILED', reason });
      return finish({
        runId, mode, autonomy: level, status: e instanceof BudgetExceeded ? 'BLOCKED' : 'FAILED', outcome: null, reason, steps,
        toolCalls: counter.counts.toolCalls, deniedCalls: counter.counts.denied, tokens: tokens.used, executed: false, escalated: mode === 'LIVE', state,
      });
    } finally {
      releaseRun(runId);
    }
  }
}
