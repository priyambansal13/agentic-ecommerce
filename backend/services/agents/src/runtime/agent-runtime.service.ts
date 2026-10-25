import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrincipalInfo } from '@ac/nest-common';
import { type BaseEvent, EventType } from '@ag-ui/core';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { randomUUID } from 'node:crypto';
import { AutonomyService } from '../governance/autonomy.service.js';
import { ToolInvoker } from '../tools/invoke-tool.js';
import { registerRun, releaseRun, type RunContext } from './context.js';
import { AGENTS } from './graphs/index.js';
import type { AgentDefinition, AgentGraph } from './types.js';

export interface AgentInterrupt {
  id: string;
  reason: string;
  message?: string;
  responseSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RunRequest {
  agentId: string;
  threadId: string;
  runId: string;
  principal?: PrincipalInfo;
  userText?: string;
  resume?: { status: 'resolved' | 'cancelled'; payload?: unknown };
  emit: (e: BaseEvent) => void;
  signal?: AbortSignal;
}

const textOf = (m: BaseMessage) => (typeof m.content === 'string' ? m.content : m.content.map((p: any) => (p.type === 'text' ? p.text : '')).join(''));

/** Compiles all graphs with the Postgres checkpointer and runs them, mapping graph progress to AG-UI events. */
@Injectable()
export class AgentRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AgentRuntime.name);
  private checkpointer!: PostgresSaver;
  private readonly graphs = new Map<string, { def: AgentDefinition; graph: AgentGraph }>();

  constructor(private readonly tools: ToolInvoker, private readonly autonomy: AutonomyService) {}

  async onModuleInit() {
    // checkpoints live in the agents service's own database (schema langgraph), next to its audit tables
    this.checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!, { schema: 'langgraph' });
    await this.checkpointer.setup();
    for (const def of Object.values(AGENTS)) this.graphs.set(def.config.id, { def, graph: def.build(this.checkpointer) });
    this.log.log(`agents ready: ${[...this.graphs.keys()].join(', ')}`);
  }

  async onModuleDestroy() {
    await this.checkpointer?.end();
  }

  definition(agentId: string) {
    return this.graphs.get(agentId)?.def;
  }

  /** compiled graph + definition (background runner, evals) */
  compiled(agentId: string) {
    return this.graphs.get(agentId);
  }

  all() {
    return [...this.graphs.values()].map(({ def }) => def);
  }

  async list() {
    return Promise.all(
      [...this.graphs.values()].map(async ({ def }) => ({
        id: def.config.id,
        version: def.config.version,
        description: def.config.description,
        autonomy: await this.autonomy.level(def.config.id, def.config.autonomyDefault),
      })),
    );
  }

  async run(req: RunRequest): Promise<{ interrupts: AgentInterrupt[] }> {
    const entry = this.graphs.get(req.agentId);
    if (!entry) throw new NotFoundException(`unknown agent ${req.agentId}`);
    const { def, graph } = entry;
    const autonomyLevel = await this.autonomy.level(def.config.id, def.config.autonomyDefault);
    if (autonomyLevel === 0) throw new BadRequestException(`agent ${req.agentId} is disabled (L0)`);

    const ctx: RunContext = {
      runId: req.runId,
      agentId: req.agentId,
      threadId: req.threadId,
      autonomyLevel,
      principal: req.principal,
      emit: req.emit,
      invokeTool: (c, name, args, opts) => this.tools.invoke(c, name, args, opts),
      currentAutonomy: () => this.autonomy.level(def.config.id, def.config.autonomyDefault),
    };
    const signals = [AbortSignal.timeout(def.config.budgets.wallClockMs), ...(req.signal ? [req.signal] : [])];
    const config = {
      configurable: { thread_id: `${req.agentId}:${req.threadId}`, run_id: req.runId },
      recursionLimit: def.config.budgets.maxSteps,
      signal: AbortSignal.any(signals),
      runName: `agent:${req.agentId}`,
      metadata: { agentId: req.agentId, agentVersion: def.config.version, runId: req.runId, principal: req.principal?.sub },
      streamMode: 'updates' as const,
    };

    let input: unknown;
    if (req.resume) {
      const st = await graph.getState(config);
      if (!st.tasks.some((t) => t.interrupts?.length)) throw new BadRequestException('nothing is waiting for input on this thread');
      input = new Command({ resume: req.resume.status === 'cancelled' ? { cancelled: true } : req.resume.payload });
    } else {
      if (!req.userText) throw new BadRequestException('user message required');
      input = { messages: [new HumanMessage(req.userText)] };
    }

    registerRun(ctx);
    const interrupts: AgentInterrupt[] = [];
    const emit = (e: Record<string, unknown>) => req.emit(e as unknown as BaseEvent);
    try {
      for await (const chunk of await graph.stream(input, config)) {
        for (const [node, update] of Object.entries(chunk)) {
          if (node === '__interrupt__') {
            for (const i of update as { id?: string; value?: any }[]) {
              const v = i.value ?? {};
              interrupts.push({ id: i.id ?? randomUUID(), reason: v.reason ?? 'input_required', message: v.message, responseSchema: v.responseSchema, metadata: v.metadata ?? {} });
            }
            continue;
          }
          emit({ type: EventType.STEP_STARTED, stepName: node });
          for (const m of ((update as { messages?: BaseMessage[] })?.messages ?? []) as BaseMessage[]) {
            if (m.getType?.() !== 'ai') continue;
            const text = textOf(m);
            if (!text) continue;
            const messageId = m.id ?? randomUUID();
            emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
            emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
            emit({ type: EventType.TEXT_MESSAGE_END, messageId });
          }
          emit({ type: EventType.STEP_FINISHED, stepName: node });
        }
      }
      if (def.uiState) {
        const st = await graph.getState(config);
        emit({ type: EventType.STATE_SNAPSHOT, snapshot: def.uiState(st.values) });
      }
      return { interrupts };
    } finally {
      releaseRun(req.runId);
    }
  }
}
