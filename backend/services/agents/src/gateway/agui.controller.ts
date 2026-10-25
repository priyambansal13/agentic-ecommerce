import { Body, Controller, HttpException, Logger, Param, Post, Req, Res } from '@nestjs/common';
import { Public, verifyBearer, type PrincipalInfo } from '@ac/nest-common';
import { type BaseEvent, EventType } from '@ag-ui/core';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { EventEncoder } from '@ag-ui/encoder';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AgentRuntime } from '../runtime/agent-runtime.service.js';
import { BudgetService } from './budget.service.js';

/**
 * AG-UI endpoint: POST /v1/agents/:agentId/run with a RunAgentInput → text/event-stream.
 * Interrupts are native AG-UI: RUN_FINISHED { outcome: { type: 'interrupt', interrupts: [...] } };
 * the client resumes with RunAgentInput.resume = [{ interruptId, status, payload }] on the same threadId.
 */
@Controller('agents')
export class AguiController {
  private readonly log = new Logger(AguiController.name);
  constructor(private readonly runtime: AgentRuntime, private readonly budget: BudgetService) {}

  @Public() // auth is per agent below (dev-only agents may be public)
  @Post(':agentId/run')
  async run(@Param('agentId') agentId: string, @Body() body: unknown, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const def = this.runtime.definition(agentId);
    if (!def) return reply.status(404).send({ error: `unknown agent ${agentId}` });

    let principal: PrincipalInfo | undefined;
    if (!def.config.public) {
      try {
        principal = await verifyBearer(req.headers.authorization);
      } catch (e) {
        return reply.status(401).send({ error: (e as Error).message });
      }
    }
    try {
      await this.budget.takeRun(agentId, principal?.sub ?? req.ip, def.config.budgets);
    } catch (e) {
      return reply.status(429).send({ error: (e as Error).message });
    }

    const parsed = RunAgentInputSchema.safeParse(body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid RunAgentInput', issues: parsed.error.issues.slice(0, 5) });
    const input = parsed.data;
    const resume = input.resume?.[0];
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const content = lastUser && 'content' in lastUser ? lastUser.content : undefined;
    const userText = (typeof content === 'string' ? content : (content ?? []).map((p: any) => (p.type === 'text' ? p.text : '')).join('\n')).trim();
    if (!resume && !userText) return reply.status(400).send({ error: 'send a user message or resume entries' });

    const encoder = new EventEncoder({ accept: req.headers.accept });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const abort = new AbortController();
    let closed = false;
    res.on('close', () => {
      closed = true;
      abort.abort();
    });
    const send = (e: Record<string, unknown>) => !closed && res.write(encoder.encode(e as unknown as BaseEvent));
    const keepalive = setInterval(() => !closed && res.write(': keepalive\n\n'), 15_000);
    const { threadId, runId } = input;
    send({ type: EventType.RUN_STARTED, threadId, runId });
    try {
      const { interrupts } = await this.runtime.run({
        agentId,
        threadId,
        runId,
        principal,
        userText: userText || undefined,
        resume: resume ? { status: resume.status as 'resolved' | 'cancelled', payload: resume.payload } : undefined,
        emit: (e) => send(e as unknown as Record<string, unknown>),
        signal: abort.signal,
      });
      send({ type: EventType.RUN_FINISHED, threadId, runId, outcome: interrupts.length ? { type: 'interrupt', interrupts } : { type: 'success' } });
    } catch (e) {
      if (abort.signal.aborted && closed) {
        this.log.warn(`run ${runId} cancelled by client`);
      } else {
        const message = e instanceof HttpException ? e.message : 'Agent run failed';
        this.log.error(`run ${runId} failed: ${(e as Error).message}`);
        send({ type: EventType.RUN_ERROR, message });
      }
    } finally {
      clearInterval(keepalive);
      if (!closed) res.end();
    }
  }
}
