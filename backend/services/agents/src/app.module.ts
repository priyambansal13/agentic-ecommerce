import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { AgentsController } from './gateway/agents.controller.js';
import { AguiController } from './gateway/agui.controller.js';
import { BudgetService } from './gateway/budget.service.js';
import { GovernanceController } from './gateway/governance.controller.js';
import { AuditService } from './governance/audit.service.js';
import { AutonomyService } from './governance/autonomy.service.js';
import { OpaClient } from './governance/opa.client.js';
import { RedisClient } from './governance/redis.js';
import { DashboardController } from './modules/dashboard/dashboard.controller.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { AgentRunner } from './runtime/agent-runner.service.js';
import { AgentRuntime } from './runtime/agent-runtime.service.js';
import { RunRequestsService } from './runtime/run-requests.service.js';
import { ToolInvoker } from './tools/invoke-tool.js';

/**
 * Agent Gateway + Runtime microservice (platform/docs/02-lld.md §2.12, 03-agentic-ai.md).
 * gateway/ (AG-UI SSE, governance API, budgets) → runtime/ (LangGraph graphs + Postgres checkpointer, background
 * runner, event-driven run requests) → tools/ (registry, invokeTool) → governance/ (OPA, autonomy/kill switch, audit).
 */
@Module({
  imports: [CoreModule.forService({ name: 'agents', database: true })],
  controllers: [AguiController, GovernanceController, AgentsController, DashboardController],
  providers: [AgentRuntime, AgentRunner, RunRequestsService, ToolInvoker, OpaClient, RedisClient, AutonomyService, AuditService, BudgetService, DashboardService],
})
export class AppModule {}
