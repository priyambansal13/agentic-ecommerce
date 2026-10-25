import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { FeesModule } from './modules/fees/fees.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';

/**
 * Payment service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'payment', database: true }), FeesModule, DashboardModule, PaymentsModule],
})
export class AppModule {}
