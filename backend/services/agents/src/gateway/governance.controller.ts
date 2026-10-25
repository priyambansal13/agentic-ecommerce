import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { AgentRegistrySchema, AgentRunsSchema, AutonomyInputSchema, EvalReportSchema } from '@ac/contracts';
import type { z } from 'zod';
import { Principal, type PrincipalInfo, Roles, ZodPipe } from '@ac/nest-common';
import { DataSource } from 'typeorm';
import { AutonomyService } from '../governance/autonomy.service.js';
import { AgentRuntime } from '../runtime/agent-runtime.service.js';
import { modelIds, modelProvider } from '../runtime/models.js';
import { RunRequestsService } from '../runtime/run-requests.service.js';
import type { AutonomyLevel } from '../runtime/types.js';
import { BudgetService } from './budget.service.js';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Agent governance for admins (docs/03 §3.3): registry + autonomy (kill switch), runs, re-runs, eval results. */
@Controller('agents')
export class GovernanceController {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly autonomy: AutonomyService,
    private readonly budget: BudgetService,
    private readonly requests: RunRequestsService,
    private readonly db: DataSource,
  ) {}

  /** GET /v1/agents/registry */
  @Roles('admin')
  @Get('registry')
  async registry() {
    const provider = modelProvider();
    const items = await Promise.all(
      this.runtime.all().map(async (def) => ({
        id: def.config.id,
        version: def.config.version,
        description: def.config.description,
        autonomy: await this.autonomy.level(def.config.id, def.config.autonomyDefault),
        maxAutonomy: def.config.maxAutonomy,
        model: { provider, fast: provider === 'openai' ? modelIds.fast() : 'offline-heuristics-v1', smart: provider === 'openai' ? modelIds.smart() : 'offline-heuristics-v1' },
        budgets: {
          maxSteps: def.config.budgets.maxSteps,
          maxTokens: def.config.budgets.maxTokens,
          dailyRuns: this.budget.limits(def.config.id, def.config.budgets).perAgent,
          runsToday: await this.budget.runsToday(def.config.id),
        },
        lastChange: await this.autonomy.lastChange(def.config.id),
      })),
    );
    return AgentRegistrySchema.parse({ items });
  }

  /** PUT /v1/agents/:agentId/autonomy { level, reason } — audited; effective within 10 s on every replica */
  @Roles('admin')
  @Put(':agentId/autonomy')
  async setAutonomy(@Param('agentId') agentId: string, @Body(new ZodPipe(AutonomyInputSchema)) body: z.infer<typeof AutonomyInputSchema>, @Principal() p: PrincipalInfo) {
    const def = this.runtime.definition(agentId);
    if (!def) throw new NotFoundException(`unknown agent ${agentId}`);
    return this.autonomy.set(agentId, body.level as AutonomyLevel, def.config.maxAutonomy, def.config.autonomyDefault, p.name ? `${p.name} (${p.sub})` : p.sub, body.reason);
  }

  /** GET /v1/agents/runs?agentId=&limit= */
  @Roles('admin')
  @Get('runs')
  async runs(@Query('agentId') agentId?: string, @Query('limit') limit = '50') {
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    const rows = await this.db.query(
      `SELECT * FROM agent_runs WHERE ($1::text IS NULL OR agent_id = $1) ORDER BY started_at DESC LIMIT ${n}`,
      [agentId ?? null],
    );
    return AgentRunsSchema.parse({
      items: rows.map((r: any) => ({
        runId: r.run_id, agentId: r.agent_id, subject: r.subject, mode: r.mode, status: r.status, steps: r.steps, toolCalls: r.tool_calls,
        deniedCalls: r.denied_calls, outcome: r.outcome, startedAt: iso(r.started_at)!, tokens: r.tokens,
        durationMs: r.finished_at ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime() : null,
      })),
    });
  }

  /** POST /v1/agents/refund/runs { caseId } — re-run the refund agent on a case (current autonomy applies) */
  @Roles('admin')
  @Post('refund/runs')
  async rerun(@Body() body: { caseId?: string }) {
    if (!body?.caseId || !UUID.test(body.caseId)) throw new BadRequestException('caseId (uuid) required');
    return this.requests.rerun('refund', body.caseId);
  }

  /** GET /v1/agents/:agentId/evals/latest */
  @Roles('admin')
  @Get(':agentId/evals/latest')
  async latestEval(@Param('agentId') agentId: string) {
    const [row] = await this.db.query(`SELECT report FROM eval_reports WHERE agent_id = $1 ORDER BY run_at DESC LIMIT 1`, [agentId]);
    if (!row) throw new NotFoundException(`no eval run recorded for ${agentId} — run: pnpm --filter @ac/agents run evals -- --agent ${agentId}`);
    return EvalReportSchema.parse(row.report);
  }
}
