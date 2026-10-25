import { Controller, Get } from '@nestjs/common';
import { Principal, type PrincipalInfo, Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Role dashboards (read models over this service's own database). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard/buyer — the caller's own orders */
  @Roles('buyer')
  @Get('buyer')
  buyer(@Principal() p: PrincipalInfo) {
    return this.dashboards.buyer(p.sub);
  }

  /** GET /v1/dashboard/seller — the caller's own sub-orders */
  @Roles('seller')
  @Get('seller')
  seller(@Principal() p: PrincipalInfo) {
    return this.dashboards.seller(p.sub);
  }

  /** GET /v1/dashboard/platform — marketplace-wide GMV */
  @Roles('admin', 'finance')
  @Get('platform')
  platform() {
    return this.dashboards.platform();
  }
}
