import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ReturnsModule } from './modules/returns/returns.module.js';

/**
 * Returns service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'returns', database: true }), DashboardModule, ReturnsModule],
})
export class AppModule {}
