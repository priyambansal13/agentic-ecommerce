import { Injectable } from '@nestjs/common';
import { type BaseEvent, EventType } from '@ag-ui/core';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../governance/audit.service.js';
import { OpaClient } from '../governance/opa.client.js';
import type { RunContext } from '../runtime/context.js';
import type { ToolCallContext } from './define-tool.js';
import { TOOLS } from './registry.js';

export class ToolDeniedError extends Error {
  constructor(readonly tool: string, readonly reasons: string[]) {
    super(`tool ${tool} denied: ${reasons.join('; ') || 'policy'}`);
  }
}

/**
 * The only way agents touch the outside world:
 * zod args → CURRENT autonomy / kill switch (re-read before every WRITE/MONEY call) → OPA (+ server-side opaContext)
 * → handler (Idempotency-Key runId:toolCallId) → zod output → hash-chained audit (allowed AND denied) → AG-UI events.
 */
@Injectable()
export class ToolInvoker {
  constructor(private readonly opa: OpaClient, private readonly audit: AuditService) {}

  async invoke(run: RunContext, name: string, rawArgs: unknown, opts: { userConfirmed?: boolean; toolCallId?: string } = {}) {
    const tool = TOOLS[name];
    if (!tool || !tool.agents.includes(run.agentId)) throw new ToolDeniedError(name, ['unknown tool for this agent']);
    const toolCallId = opts.toolCallId ?? randomUUID();
    const ctx: ToolCallContext = { ...run, toolCallId, idempotencyKey: `${run.runId}:${toolCallId}` };
    const args = tool.input.parse(rawArgs);
    const send = (e: Record<string, unknown>) => run.emit(e as unknown as BaseEvent);
    send({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: name });
    send({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(args) });
    send({ type: EventType.TOOL_CALL_END, toolCallId });

    const base = { runId: run.runId, agentId: run.agentId, tool: name, tier: tool.tier, principalId: run.principal?.sub ?? run.facts?.buyerId ?? undefined, actor: `agent:${run.agentId}`, args };
    // kill switch / autonomy is re-read for every mutating call — a change applies mid-run (≤ 10 s cache)
    const level = tool.tier === 'READ' || !run.currentAutonomy ? run.autonomyLevel : await run.currentAutonomy();
    let decision: { allow: boolean; reasons: string[] };
    if (level === 0) decision = { allow: false, reasons: ['agent disabled (L0 kill switch)'] };
    else {
      let extra: Record<string, unknown> = {};
      try {
        extra = tool.opaContext ? await tool.opaContext(ctx, args) : {};
      } catch (e) {
        extra = { context_error: (e as Error).message };
      }
      decision = extra.context_error
        ? { allow: false, reasons: [`could not load policy facts: ${String(extra.context_error)}`] }
        : await this.opa.decide({
            agent: { id: run.agentId, autonomy_level: level },
            tool: name,
            tool_tier: tool.tier,
            args: snake(args),
            user_confirmed: opts.userConfirmed === true,
            ...extra,
          });
    }
    if (!decision.allow) {
      await this.audit.record({ ...base, allowed: false, reasons: decision.reasons, resultStatus: 'DENIED' });
      send({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId, role: 'tool', content: JSON.stringify({ denied: true, reasons: decision.reasons }) });
      throw new ToolDeniedError(name, decision.reasons);
    }
    try {
      const result = tool.output.parse(await tool.handler(ctx, args));
      await this.audit.record({ ...base, allowed: true, reasons: [], resultStatus: 'OK' });
      send({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId, role: 'tool', content: JSON.stringify(result) });
      return result;
    } catch (e) {
      await this.audit.record({ ...base, allowed: true, reasons: [(e as Error).message.slice(0, 300)], resultStatus: 'ERROR' });
      send({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId, role: 'tool', content: JSON.stringify({ error: 'tool failed' }) });
      throw e;
    }
  }
}

/** OPA policies use snake_case keys (amount_minor); tools use camelCase (amountMinor). */
export function snake(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snake);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), snake(x)]));
  return v;
}
