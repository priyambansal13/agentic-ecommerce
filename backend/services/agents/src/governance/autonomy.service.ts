import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AutonomyLevel } from '../runtime/types.js';
import { AuditService } from './audit.service.js';
import { RedisClient } from './redis.js';

const CACHE_SEC = 10;
const key = (agentId: string) => `agents:autonomy:${agentId}`;

/**
 * Effective autonomy per agent (L0 = kill switch). Source of truth: agent_autonomy (agents DB); cached in Redis for
 * 10 s so every replica sees a change within ≤ 10 s. Read before every WRITE/MONEY tool call (ToolInvoker), not only
 * at run start. Changes are admin-only, bounded by the agent's maxAutonomy, recorded in agent_autonomy_history AND in
 * the hash-chained audit, and mirrored to OPA (data.agents.killswitch) as defence in depth.
 * Fallbacks: Redis down → DB; DB row missing → AGENT_AUTONOMY_<ID> env → the agent's default.
 */
@Injectable()
export class AutonomyService {
  private readonly log = new Logger(AutonomyService.name);
  private readonly local = new Map<string, { level: AutonomyLevel; at: number }>();

  constructor(private readonly db: DataSource, private readonly redis: RedisClient, private readonly audit: AuditService) {}

  private envDefault(agentId: string, fallback: AutonomyLevel): AutonomyLevel {
    const raw = process.env[`AGENT_AUTONOMY_${agentId.toUpperCase().replace(/-/g, '_')}`];
    const n = raw === undefined ? fallback : Number(raw);
    return (Number.isInteger(n) && n >= 0 && n <= 4 ? n : fallback) as AutonomyLevel;
  }

  async level(agentId: string, fallback: AutonomyLevel): Promise<AutonomyLevel> {
    try {
      const cached = await this.redis.get(key(agentId));
      if (cached !== null) return Number(cached) as AutonomyLevel;
    } catch {
      // Redis unavailable → in-process cache (same 10 s bound), then DB
      const l = this.local.get(agentId);
      if (l && Date.now() - l.at < CACHE_SEC * 1000) return l.level;
    }
    const [row] = await this.db.query(`SELECT level FROM agent_autonomy WHERE agent_id = $1`, [agentId]);
    const level = (row ? Number(row.level) : this.envDefault(agentId, fallback)) as AutonomyLevel;
    this.local.set(agentId, { level, at: Date.now() });
    await this.redis.setEx(key(agentId), String(level), CACHE_SEC).catch(() => undefined);
    return level;
  }

  async lastChange(agentId: string) {
    const [row] = await this.db.query(`SELECT changed_by, reason, changed_at FROM agent_autonomy WHERE agent_id = $1`, [agentId]);
    return row ? { by: String(row.changed_by), reason: String(row.reason), at: new Date(row.changed_at).toISOString() } : null;
  }

  async set(agentId: string, level: AutonomyLevel, max: AutonomyLevel, fallback: AutonomyLevel, by: string, reason: string) {
    if (level > max) throw new BadRequestException(`agent ${agentId} cannot run above L${max}`);
    const from = await this.level(agentId, fallback);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO agent_autonomy (agent_id, level, changed_by, reason, changed_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (agent_id) DO UPDATE SET level = EXCLUDED.level, changed_by = EXCLUDED.changed_by, reason = EXCLUDED.reason, changed_at = now()`,
        [agentId, level, by, reason],
      );
      await tx.query(`INSERT INTO agent_autonomy_history (agent_id, from_level, to_level, changed_by, reason) VALUES ($1,$2,$3,$4,$5)`, [agentId, from, level, by, reason]);
    });
    this.local.set(agentId, { level, at: Date.now() });
    await this.redis.setEx(key(agentId), String(level), CACHE_SEC).catch((e) => this.log.warn(`redis: ${(e as Error).message} — replicas pick the change up from the DB`));
    await this.audit.record({ runId: `admin:${Date.now()}`, agentId, tool: 'setAutonomy', tier: 'ADMIN', principalId: by, actor: `user:${by}`, args: { from, to: level, reason }, allowed: true, reasons: [], resultStatus: 'OK' });
    await this.pushKillSwitch(agentId, level === 0);
    return { agentId, from, to: level };
  }

  /** Mirror L0 into OPA data so the policy engine denies even if a stale level reached the invoker. Best effort. */
  private async pushKillSwitch(agentId: string, killed: boolean) {
    const url = `${process.env.OPA_URL ?? 'http://localhost:58181'}/v1/data/agents/killswitch/${encodeURIComponent(agentId)}`;
    try {
      const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(killed), signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      this.log.warn(`could not mirror kill switch to OPA: ${(e as Error).message} (the invoker still enforces L0)`);
    }
  }
}
