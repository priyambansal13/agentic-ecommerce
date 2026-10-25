import { Injectable } from '@nestjs/common';
import { AgentsDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';
import { AuditService } from '../../governance/audit.service.js';
import { AgentRuntime } from '../../runtime/agent-runtime.service.js';

const n = (v: unknown) => Number(v ?? 0);

/** Agent oversight — REAL audit data only (tool_calls is never seeded). */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource, private readonly runtime: AgentRuntime, private readonly audit: AuditService) {}

  async summary() {
    const [k] = await this.db.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE opa_allow) AS allowed, count(*) FILTER (WHERE NOT opa_allow) AS denied,
              count(*) FILTER (WHERE result_status = 'ERROR') AS errors
         FROM tool_calls WHERE at > now() - interval '24 hours'`,
    );
    const byTool = await this.db.query(
      `SELECT tool, count(*) AS c, count(*) FILTER (WHERE NOT opa_allow) AS denied
         FROM tool_calls WHERE at > now() - interval '24 hours' GROUP BY tool ORDER BY c DESC LIMIT 10`,
    );
    const recent = await this.db.query(
      `SELECT at, agent_id, tool, risk_tier, opa_allow, result_status, opa_reasons FROM tool_calls ORDER BY seq DESC LIMIT 20`,
    );
    return AgentsDashboardSchema.parse({
      agents: await this.runtime.list(),
      toolCalls24h: { total: n(k.total), allowed: n(k.allowed), denied: n(k.denied), errors: n(k.errors) },
      byTool: byTool.map((r: any) => ({ tool: r.tool, count: n(r.c), denied: n(r.denied) })),
      recent: recent.map((r: any) => ({
        at: new Date(r.at).toISOString(),
        agent: r.agent_id,
        tool: r.tool,
        tier: r.risk_tier,
        allowed: r.opa_allow,
        result: r.result_status,
        reasons: r.opa_reasons ?? [],
      })),
      chainIntact: await this.audit.verifyChain(),
    });
  }
}
