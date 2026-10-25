import { Controller, Get } from '@nestjs/common';
import { Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Admin & moderation dashboards (this service's own database + platform health probes). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard/moderation — listing queue with the moderation agent's verdicts */
  @Roles('moderator', 'admin')
  @Get('moderation')
  moderation() {
    return this.dashboards.moderation();
  }

  /** GET /v1/dashboard/overview — disputes, moderation backlog, sanctions */
  @Roles('admin')
  @Get('overview')
  overview() {
    return this.dashboards.overview();
  }

  /** GET /v1/dashboard/platform-health — every service's /health via Kong */
  @Roles('admin')
  @Get('platform-health')
  platformHealth() {
    return this.dashboards.platformHealth();
  }
}
