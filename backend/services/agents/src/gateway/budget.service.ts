import { Injectable, Logger } from '@nestjs/common';
import { RedisClient } from '../governance/redis.js';

export class BudgetExceeded extends Error {
  constructor(readonly budget: string) {
    super(`budget exceeded: ${budget}`);
  }
}

const DAY_SEC = 26 * 3600;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Daily run budgets as Redis counters (INCR + EXPIRE; shared by all replicas): per principal (user/case owner) and
 * per agent. Fails CLOSED when Redis is unavailable — a run that cannot be counted does not start (it escalates).
 * Per-run budgets (steps, tokens, wall clock) are enforced inside the run (recursionLimit, RunTokens, AbortSignal).
 * Env overrides for tests/ops: AGENT_RUNS_PER_DAY_<ID>, AGENT_RUNS_PER_USER_PER_DAY_<ID>.
 */
@Injectable()
export class BudgetService {
  private readonly log = new Logger(BudgetService.name);
  constructor(private readonly redis: RedisClient) {}

  private override(name: string, agentId: string, fallback: number) {
    const raw = process.env[`${name}_${agentId.toUpperCase().replace(/-/g, '_')}`];
    return raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
  }

  limits(agentId: string, b: { runsPerUserPerDay: number; runsPerAgentPerDay: number }) {
    return {
      perUser: this.override('AGENT_RUNS_PER_USER_PER_DAY', agentId, b.runsPerUserPerDay),
      perAgent: this.override('AGENT_RUNS_PER_DAY', agentId, b.runsPerAgentPerDay),
    };
  }

  /** Counts one run; throws BudgetExceeded when either daily budget is used up (or Redis is down). */
  async takeRun(agentId: string, who: string, b: { runsPerUserPerDay: number; runsPerAgentPerDay: number }) {
    const { perUser, perAgent } = this.limits(agentId, b);
    let agentRuns: number;
    let userRuns: number;
    try {
      agentRuns = await this.redis.incrWithTtl(`agents:budget:${today()}:${agentId}`, DAY_SEC);
      userRuns = await this.redis.incrWithTtl(`agents:budget:${today()}:${agentId}:${who}`, DAY_SEC);
    } catch (e) {
      this.log.error(`budget counters unavailable (${(e as Error).message}) — failing closed`);
      throw new BudgetExceeded('counters unavailable');
    }
    if (agentRuns > perAgent) throw new BudgetExceeded(`${agentId} daily runs (${perAgent})`);
    if (userRuns > perUser) throw new BudgetExceeded(`${agentId} runs per user per day (${perUser})`);
  }

  async runsToday(agentId: string) {
    return Number((await this.redis.get(`agents:budget:${today()}:${agentId}`).catch(() => null)) ?? 0);
  }
}

/** Per-run token meter (model calls add usage; exceeding maxTokens aborts the run → escalation). */
export class RunTokens {
  used = 0;
  constructor(private readonly max: number) {}
  add(n: number) {
    this.used += n;
    if (this.max > 0 && this.used > this.max) throw new BudgetExceeded(`tokens per run (${this.max})`);
  }
}
