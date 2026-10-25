import { Controller, Get } from '@nestjs/common';
import { Principal, type PrincipalInfo, Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Seller stock widget (this service's own database). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard/seller — the caller's own SKUs: totals and low stock */
  @Roles('seller')
  @Get('seller')
  seller(@Principal() p: PrincipalInfo) {
    return this.dashboards.seller(p.sub);
  }
}
