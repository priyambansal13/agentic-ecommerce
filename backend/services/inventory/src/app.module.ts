import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { StockModule } from './modules/stock/stock.module.js';

/**
 * Inventory service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'inventory', database: true }), DashboardModule, StockModule],
})
export class AppModule {}
