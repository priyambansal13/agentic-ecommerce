import { Controller, Get } from '@nestjs/common';
import { Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Fraud analyst dashboard (this service's own database). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard — alert workload, score distribution, top rules, recent alerts */
  @Roles('fraud-analyst', 'admin')
  @Get()
  summary() {
    return this.dashboards.summary();
  }
}
