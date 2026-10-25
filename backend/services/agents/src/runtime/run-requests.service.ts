import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { parseEvent, TOPICS } from '@ac/contracts';
import { EventConsumerService } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { AgentRunner } from './agent-runner.service.js';

const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) && typeof r[1] === 'number' ? r[0] : r);

/**
 * Event-driven agent runs. The consumer only RECORDS a run request (idempotent per agent + subject + trigger, in the
 * same transaction as processed_events) — graphs never run inside a Kafka handler. A worker loop claims PENDING
 * requests with FOR UPDATE SKIP LOCKED (safe with several replicas), runs them, retries twice on infrastructure
 * errors. Triggers: returns.return_requested.v1 → refund agent (trigger "event"); admins → trigger "manual:<uuid>".
 */
@Injectable()
export class RunRequestsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(RunRequestsService.name);
  private timer?: NodeJS.Timeout;
  private active = 0;
  private readonly concurrency = Number(process.env.AGENT_WORKER_CONCURRENCY ?? 2);

  constructor(private readonly db: DataSource, private readonly events: EventConsumerService, private readonly runner: AgentRunner) {}

  async onModuleInit() {
    if (process.env.AGENT_WORKER === 'off') return this.log.warn('agent worker disabled (AGENT_WORKER=off)');
    await this.events.subscribe('refund-agent', [TOPICS.returns], (evt, tx) => this.onReturnsEvent(evt, tx));
    this.timer = setInterval(() => void this.tick(), Number(process.env.AGENT_WORKER_POLL_MS ?? 1500));
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async onReturnsEvent(evt: { type: string }, tx: EntityManager) {
    if (evt.type !== 'returns.return_requested.v1') return;
    let e;
    try {
      e = parseEvent('returns.return_requested.v1', evt);
    } catch (err) {
      return this.log.warn(`skipping malformed returns.return_requested.v1: ${(err as Error).message}`);
    }
    await this.enqueue(tx, 'refund', e.data.caseId, 'event', { caseId: e.data.caseId, buyerId: e.data.buyerId, orderId: e.data.orderId, eventId: e.id });
  }

  async enqueue(tx: EntityManager | DataSource, agentId: string, caseId: string, trigger: string, payload: Record<string, unknown>) {
    const r = rowsOf(await tx.query(
      `INSERT INTO agent_run_requests (id, agent_id, subject, trigger, payload) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (agent_id, subject, trigger) DO NOTHING RETURNING id`,
      [randomUUID(), agentId, `case:${caseId}`, trigger, JSON.stringify(payload)],
    ));
    return r[0]?.id as string | undefined;
  }

  /** Admin re-run: carries the buyer id from the original event request when one exists. */
  async rerun(agentId: string, caseId: string) {
    const [orig] = rowsOf(await this.db.query(`SELECT payload FROM agent_run_requests WHERE agent_id = $1 AND subject = $2 ORDER BY created_at LIMIT 1`, [agentId, `case:${caseId}`]));
    const id = await this.enqueue(this.db, agentId, caseId, `manual:${randomUUID()}`, { caseId, buyerId: orig?.payload?.buyerId ?? null });
    return { requestId: id!, caseId };
  }

  async tick() {
    while (this.active < this.concurrency) {
      const claimed = await this.claim().catch((e) => {
        this.log.error(`claim failed: ${(e as Error).message}`);
        return null;
      });
      if (!claimed) return;
      this.active++;
      void this.process(claimed).finally(() => this.active--);
    }
  }

  private async claim(): Promise<{ id: string; agent_id: string; payload: any; attempts: number } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = rowsOf(await tx.query(
        `SELECT id, agent_id, payload, attempts FROM agent_run_requests WHERE status = 'PENDING' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      ));
      if (!row) return null;
      await tx.query(`UPDATE agent_run_requests SET status = 'RUNNING', attempts = attempts + 1, updated_at = now() WHERE id = $1`, [row.id]);
      return row;
    });
  }

  private async process(r: { id: string; agent_id: string; payload: any; attempts: number }) {
    try {
      const s = await this.runner.runSubject({ agentId: r.agent_id, caseId: r.payload.caseId, trigger: r.id, facts: { buyerId: r.payload.buyerId ?? null, orderId: r.payload.orderId ?? null } });
      // retry only infrastructure failures (timeouts, open breaker, network, HTTP 5xx) — never 4xx answers
      const retry = s.status === 'FAILED' && /(: timeout\b|circuit open|: network|ECONNREFUSED|→ 5\d\d\b)/.test(s.reason) && r.attempts < 3;
      await this.db.query(`UPDATE agent_run_requests SET status = $2, run_id = $3, last_error = $4, updated_at = now() WHERE id = $1`, [r.id, retry ? 'PENDING' : s.status === 'FAILED' ? 'FAILED' : 'DONE', s.runId, s.status === 'COMPLETED' ? null : s.reason.slice(0, 500)]);
      this.log.log(`${r.agent_id} ${r.payload.caseId}: ${s.mode} ${s.status} ${s.outcome ?? ''} (${s.reason})`);
    } catch (e) {
      await this.db.query(`UPDATE agent_run_requests SET status = $2, last_error = $3, updated_at = now() WHERE id = $1`, [r.id, r.attempts < 3 ? 'PENDING' : 'FAILED', (e as Error).message.slice(0, 500)]);
      this.log.error(`run request ${r.id} failed: ${(e as Error).message}`);
    }
  }
}
