import type { PrincipalInfo } from '@ac/nest-common';
import type { BaseEvent } from '@ag-ui/core';
import type { RunnableConfig } from '@langchain/core/runnables';
import { randomUUID } from 'node:crypto';
import type { RunTokens } from '../gateway/budget.service.js';
import type { RunTrace } from '../governance/tracing.js';
import type { DomainPort } from './domain.js';
import type { RefundModel } from './models.js';
import type { AutonomyLevel } from './types.js';

/**
 * Per-run context (principal token, emitter, tool invoker, domain port, model, meters). Kept in memory keyed by run
 * id — only `run_id` travels in config.configurable, so tokens never end up in checkpoints.
 */
export interface RunContext {
  runId: string;
  agentId: string;
  threadId: string;
  /** autonomy at run start (the invoker re-reads the CURRENT level before every WRITE/MONEY call) */
  autonomyLevel: AutonomyLevel;
  principal?: PrincipalInfo;
  emit: (e: BaseEvent) => void;
  invokeTool: (ctx: RunContext, name: string, args: unknown, opts: { userConfirmed?: boolean; toolCallId: string }) => Promise<unknown>;
  /** current effective autonomy (kill switch), read fresh — set by the runtime */
  currentAutonomy?: () => Promise<AutonomyLevel>;
  /** domain services (returns, fraud) — HTTP in production, fakes in evals */
  domain?: DomainPort;
  model?: RefundModel;
  tokens?: RunTokens;
  trace?: RunTrace;
  /** extra facts known from the trigger (e.g. buyerId from returns.return_requested.v1) — never from the model */
  facts?: Record<string, string | null>;
}

const runs = new Map<string, RunContext>();
export const registerRun = (ctx: RunContext) => runs.set(ctx.runId, ctx);
export const releaseRun = (runId: string) => runs.delete(runId);

export function runContext(config: RunnableConfig): RunContext {
  const ctx = runs.get(config.configurable?.run_id as string);
  if (!ctx) throw new Error('run context missing — graphs must be invoked through AgentRuntime');
  return ctx;
}

/** Inside a node: `const tools = toolkit(config); const order = await tools.call('getOrder', { orderId });` */
export function toolkit(config: RunnableConfig) {
  const ctx = runContext(config);
  return {
    call: <T = unknown>(name: string, args: unknown, opts: { userConfirmed?: boolean } = {}) =>
      ctx.invokeTool(ctx, name, args, { ...opts, toolCallId: randomUUID() }) as Promise<T>,
  };
}
