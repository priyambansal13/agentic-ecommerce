import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { CommerceModule } from './modules/commerce/commerce.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';

/**
 * Order service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Commerce (cart, checkout saga, lifecycle) lives in modules/commerce; calls catalog/inventory/fraud/payment via Kong.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'order', database: true }), DashboardModule, OrdersModule, CommerceModule],
})
export class AppModule {}
