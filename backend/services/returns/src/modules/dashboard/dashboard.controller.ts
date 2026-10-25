import { Controller, Get } from '@nestjs/common';
import { Principal, type PrincipalInfo, Roles } from '@ac/nest-common';
import { DashboardService } from './dashboard.service.js';

/** Role dashboards (read models over this service's own database). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  /** GET /v1/dashboard/buyer — the caller's own returns / refund cases */
  @Roles('buyer')
  @Get('buyer')
  buyer(@Principal() p: PrincipalInfo) {
    return this.dashboards.buyer(p.sub);
  }

  /** GET /v1/dashboard/support — human-review queue for refund-agent escalations */
  @Roles('support', 'admin')
  @Get('support')
  support() {
    return this.dashboards.support();
  }

  /** GET /v1/dashboard/finance — high-value refunds awaiting the finance (dual-control) approval */
  @Roles('finance', 'admin')
  @Get('finance')
  finance() {
    return this.dashboards.finance();
  }
}
