import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { RiskModule } from './modules/risk/risk.module.js';

/**
 * Fraud service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'fraud', database: true }), DashboardModule, RiskModule],
})
export class AppModule {}
