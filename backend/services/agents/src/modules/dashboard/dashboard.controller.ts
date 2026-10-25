import { Controller, Get } from '@nestjs/common';
import { Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Agent oversight dashboard (admins). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard — agents + autonomy, tool calls (24 h), recent audit rows, hash-chain integrity */
  @Roles('admin')
  @Get()
  summary() {
    return this.dashboards.summary();
  }
}
