import { Controller, Get } from '@nestjs/common';
import { Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Catalog summary widget (this service's own database). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard — listing counts by status and active sellers */
  @Roles('admin', 'moderator')
  @Get()
  summary() {
    return this.dashboards.summary();
  }
}
