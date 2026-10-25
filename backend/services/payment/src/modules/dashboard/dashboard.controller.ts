import { Controller, Get } from '@nestjs/common';
import { Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Finance dashboard (this service's own database). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard/finance — captures, refunds, payouts and ledger balance */
  @Roles('finance', 'admin')
  @Get('finance')
  finance() {
    return this.dashboards.finance();
  }
}
